import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { config } from '../config.js';
import { enqueueSgnlSync } from '../queues/index.js';
import { DrizzleSgnlExportRepository } from '../repositories/drizzle/sgnl-export.drizzle.js';
import { describeSgnlError, SgnlApiError, SgnlAuthError } from '../services/sgnl/sgnl-errors.js';
import { getSgnlLastRun } from '../services/sgnl/sgnl-last-run.js';
import { runSgnlSync } from '../services/sgnl/sgnl-sync.js';
import { sgnlErrorsQuerySchema, sgnlRunBodySchema } from '../schemas/sgnl.js';

/**
 * Маршруты интеграции SIGNAL DOCS (только admin).
 *
 *   GET  /api/sgnl/projects — проекты SIGNAL для сопоставления объектов;
 *   GET  /api/sgnl/status   — подключение, права записи, журнал, итог последнего прогона;
 *   POST /api/sgnl/preview  — предпросмотр выгрузки (dry-run, без записи в SIGNAL);
 *   POST /api/sgnl/run      — поставить прогон выгрузки в очередь worker;
 *   GET  /api/sgnl/errors   — файлы с ошибкой выгрузки.
 *
 * Проверки подключения не входят в /health: недоступность SIGNAL не влияет на живость BillHub.
 */

/** Ошибка вызова SIGNAL в формате ответа (всегда HTTP 200 — фронт различает по полям) */
interface SgnlErrorBody {
  code: string;
  httpStatus?: number;
  message: string;
}

function toErrorBody(error: unknown): SgnlErrorBody {
  if (error instanceof SgnlAuthError) {
    return { code: error.code, httpStatus: error.status, message: error.message };
  }
  if (error instanceof SgnlApiError) {
    return { code: 'api_error', httpStatus: error.status, message: describeSgnlError(error) };
  }
  return {
    code: 'network_error',
    message: error instanceof Error ? error.message : 'Сетевая ошибка',
  };
}

async function sgnlRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: [authenticate, requireRole('admin')] };

  /* ---------- GET /api/sgnl/projects ---------- */
  fastify.get('/api/sgnl/projects', adminOnly, async (request, reply) => {
    const client = fastify.sgnl;
    if (!client) return reply.send({ configured: false, ok: false, projects: [] });
    try {
      const projects = await client.listProjects();
      return reply.send({
        configured: true,
        ok: true,
        projects: projects.map((p) => ({ id: p.id, name: p.name.trim(), code: p.code || null })),
      });
    } catch (error) {
      request.log.warn({ err: error }, 'SIGNAL: получение проектов не удалось');
      return reply.send({ configured: true, ok: false, projects: [], error: toErrorBody(error) });
    }
  });

  /* ---------- GET /api/sgnl/status ---------- */
  fastify.get('/api/sgnl/status', adminOnly, async (request, reply) => {
    const db = fastify.db;
    if (!db) return reply.status(500).send({ error: 'Требуется DB_PROVIDER=drizzle' });
    const repo = new DrizzleSgnlExportRepository(db);
    const [stats, lastRun] = await Promise.all([repo.getStats(), getSgnlLastRun(db)]);

    const client = fastify.sgnl;
    const base = {
      configured: !!client,
      enabled: config.sgnlSyncEnabled,
      cron: config.sgnlSyncCron || null,
      baseUrl: client?.baseUrl,
      stats,
      lastRun,
    };
    if (!client) return reply.send({ ...base, ok: false });

    try {
      const ping = await client.ping();
      let writeAccess: { ok: boolean; error?: SgnlErrorBody };
      try {
        await client.checkWriteAccess();
        writeAccess = { ok: true };
      } catch (error) {
        writeAccess = { ok: false, error: toErrorBody(error) };
      }
      return reply.send({ ...base, ok: true, latencyMs: ping.latencyMs, writeAccess });
    } catch (error) {
      request.log.warn({ err: error }, 'SIGNAL: проверка подключения не прошла');
      return reply.send({ ...base, ok: false, error: toErrorBody(error) });
    }
  });

  /* ---------- POST /api/sgnl/preview ---------- */
  fastify.post('/api/sgnl/preview', adminOnly, async (request, reply) => {
    const db = fastify.db;
    if (!db) return reply.status(500).send({ error: 'Требуется DB_PROVIDER=drizzle' });
    const client = fastify.sgnl;
    if (!client) return reply.status(409).send({ error: 'Интеграция SIGNAL не настроена' });
    const body = sgnlRunBodySchema.parse(request.body ?? {});
    const report = await runSgnlSync(
      {
        store: new DrizzleSgnlExportRepository(db),
        client,
        downloadFile: () => Promise.reject(new Error('Предпросмотр не скачивает файлы')),
        log: request.log,
      },
      { dryRun: true, siteId: body.siteId },
    );
    return reply.send(report);
  });

  /* ---------- POST /api/sgnl/run ---------- */
  fastify.post('/api/sgnl/run', adminOnly, async (request, reply) => {
    if (!fastify.sgnl) return reply.status(409).send({ error: 'Интеграция SIGNAL не настроена' });
    if (!config.sgnlSyncEnabled) {
      return reply.status(409).send({ error: 'Выгрузка выключена (SGNL_SYNC_ENABLED=false)' });
    }
    const body = sgnlRunBodySchema.parse(request.body ?? {});
    const jobId = await enqueueSgnlSync(body.siteId);
    request.log.info({ jobId, siteId: body.siteId ?? null }, 'SIGNAL: прогон поставлен в очередь');
    return reply.send({ queued: true, jobId });
  });

  /* ---------- GET /api/sgnl/errors ---------- */
  fastify.get('/api/sgnl/errors', adminOnly, async (request, reply) => {
    const db = fastify.db;
    if (!db) return reply.status(500).send({ error: 'Требуется DB_PROVIDER=drizzle' });
    const { limit } = sgnlErrorsQuerySchema.parse(request.query ?? {});
    const errors = await new DrizzleSgnlExportRepository(db).listErrors(limit);
    return reply.send({ errors });
  });
}

export default sgnlRoutes;
