import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { PayHubApiError } from '../services/payhub/payhub-errors.js';
import { getRpSenderSetting, setRpSenderSetting } from '../services/rp/rp-sender-setting.js';
import { rpSenderPutBodySchema } from '../schemas/payhub.js';

/**
 * Маршруты интеграции PayHub.
 *
 * GET /api/payhub/status — проверка подключения ТОЛЬКО для UI админки.
 * НЕ включается в /health и readiness-проверки: недоступность PayHub
 * не должна влиять на живость BillHub.
 */

/** Ответ проверки подключения (всегда HTTP 200 — фронт различает состояния по полям) */
interface PayHubStatusResponse {
  /** Заданы ли PAYHUB_BASE_URL/PAYHUB_API_TOKEN */
  configured: boolean;
  /** Успешен ли пробный вызов PayHub */
  ok: boolean;
  baseUrl?: string;
  latencyMs?: number;
  error?: {
    /** Код PayHub (api_key_invalid, insufficient_scope, ...) или network_error */
    code: string;
    httpStatus?: number;
    message: string;
  };
}

/** Ошибка каталога в формате, совместимом со статусом */
interface PayHubCatalogError {
  code: string;
  httpStatus?: number;
  message: string;
}

/** Нормализованный проект PayHub для клиента (без индексной сигнатуры внешнего DTO) */
interface NormalizedProject {
  id: number;
  code: string | null;
  name: string | null;
}

/** Нормализованный заказчик/контрагент PayHub для клиента */
interface NormalizedContractor {
  id: string;
  name: string | null;
  inn: string | null;
}

/** Приводит ошибку вызова PayHub к формату каталога (всегда HTTP 200) */
function toCatalogError(error: unknown): PayHubCatalogError {
  return error instanceof PayHubApiError
    ? { code: error.code, httpStatus: error.status, message: error.message }
    : { code: 'network_error', message: error instanceof Error ? error.message : 'Сетевая ошибка' };
}

async function payhubRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: [authenticate, requireRole('admin')] };

  /* ---------- GET /api/payhub/projects ---------- */
  fastify.get('/api/payhub/projects', adminOnly, async (request, reply) => {
    const client = fastify.payhub;
    if (!client) {
      return reply.send({ configured: false, ok: false, projects: [] as NormalizedProject[] });
    }
    try {
      const projects = await client.listProjects();
      const normalized: NormalizedProject[] = projects.map((p) => ({
        id: p.id,
        code: p.code ?? null,
        name: p.name ?? null,
      }));
      return reply.send({ configured: true, ok: true, projects: normalized });
    } catch (error) {
      request.log.warn({ err: error }, 'PayHub: получение проектов не удалось');
      return reply.send({
        configured: true,
        ok: false,
        projects: [] as NormalizedProject[],
        error: toCatalogError(error),
      });
    }
  });

  /* ---------- GET /api/payhub/contractors ---------- */
  fastify.get('/api/payhub/contractors', adminOnly, async (request, reply) => {
    const client = fastify.payhub;
    if (!client) {
      return reply.send({
        configured: false,
        ok: false,
        contractors: [] as NormalizedContractor[],
      });
    }
    try {
      const contractors = await client.listContractors();
      const normalized: NormalizedContractor[] = contractors.map((c) => ({
        id: String(c.id),
        name: c.name ?? null,
        inn: c.inn ?? null,
      }));
      return reply.send({ configured: true, ok: true, contractors: normalized });
    } catch (error) {
      request.log.warn({ err: error }, 'PayHub: получение контрагентов не удалось');
      return reply.send({
        configured: true,
        ok: false,
        contractors: [] as NormalizedContractor[],
        error: toCatalogError(error),
      });
    }
  });

  /* ---------- GET /api/payhub/rp-sender — отправитель РП ---------- */
  /* Читают admin и user: форма письма РП показывает отправителя (секретов нет). */
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };
  fastify.get('/api/payhub/rp-sender', adminOrUser, async (_request, reply) => {
    const db = fastify.db;
    if (!db) return reply.status(500).send({ error: 'Настройки требуют DB_PROVIDER=drizzle' });
    const sender = await getRpSenderSetting(db);
    return reply.send({ sender });
  });

  /* ---------- PUT /api/payhub/rp-sender — сохранить отправителя РП ---------- */
  fastify.put('/api/payhub/rp-sender', adminOnly, async (request, reply) => {
    const db = fastify.db;
    if (!db) return reply.status(500).send({ error: 'Настройки требуют DB_PROVIDER=drizzle' });
    const body = rpSenderPutBodySchema.parse(request.body);
    await setRpSenderSetting(db, body.sender);
    return reply.send({ sender: body.sender });
  });

  /* ---------- GET /api/payhub/status ---------- */
  fastify.get('/api/payhub/status', adminOnly, async (request, reply) => {
    const client = fastify.payhub;
    if (!client) {
      const body: PayHubStatusResponse = { configured: false, ok: false };
      return reply.send(body);
    }

    try {
      const ping = await client.ping();
      const body: PayHubStatusResponse = {
        configured: true,
        ok: true,
        baseUrl: client.baseUrl,
        latencyMs: ping.latencyMs,
      };
      return reply.send(body);
    } catch (error) {
      request.log.warn({ err: error }, 'PayHub: проверка подключения не прошла');
      const body: PayHubStatusResponse = {
        configured: true,
        ok: false,
        baseUrl: client.baseUrl,
        error:
          error instanceof PayHubApiError
            ? { code: error.code, httpStatus: error.status, message: error.message }
            : {
                code: 'network_error',
                message: error instanceof Error ? error.message : 'Сетевая ошибка',
              },
      };
      return reply.send(body);
    }
  });
}

export default payhubRoutes;
