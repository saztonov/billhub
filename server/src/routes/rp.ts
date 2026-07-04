import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { DrizzleRpRepository } from '../repositories/drizzle/rp.drizzle.js';
import { ValidationError, NotFoundError } from '../repositories/types.js';
import { enqueueRpLetterSync } from '../queues/index.js';
import {
  createRpBodySchema,
  updateRpStatusBodySchema,
  rpDocumentsQuerySchema,
  rpLetterAttachmentsBodySchema,
  rpIdParamsSchema,
} from '../schemas/rp.js';

/** Санитизация имени файла вложения: без разделителей путей и управляющих символов. */
function sanitizeAttachmentName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name
    .replace(/[\\/]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  return (cleaned || 'file').slice(0, 200);
}

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов реестра РП. Только Drizzle (без Supabase).        */
/* ------------------------------------------------------------------ */

async function rpRoutes(fastify: FastifyInstance): Promise<void> {
  let repoCache: DrizzleRpRepository | null = null;
  /** Ленивая инициализация: реестр РП реализован только на Drizzle (без Supabase). */
  function getRepo(): DrizzleRpRepository {
    if (repoCache) return repoCache;
    const db = fastify.db;
    if (!db) {
      throw new Error(
        'РП-роуты требуют DB_PROVIDER=drizzle (fastify.db не инициализирован). ' +
          'Реестр РП реализован только на Drizzle.',
      );
    }
    repoCache = new DrizzleRpRepository(db);
    return repoCache;
  }

  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /** Вычисляет ограничение по объектам для обычного user (null => все объекты). */
  async function resolveSiteScope(userId: string, role: string, allSites: boolean) {
    if (role === 'admin' || allSites) return null;
    return fastify.repos.paymentRequests.getUserSiteIds(userId);
  }

  /**
   * Сверяет доступ к конкретной РП со scope пользователя (как GET /api/rp).
   * Для user вне scope РП «не существует» -> 404 (не раскрываем существование чужой РП).
   */
  async function assertRpInScope(
    rpId: string,
    user: { id: string; role: string; allSites?: boolean },
  ): Promise<void> {
    const siteId = await getRepo().getRpSiteId(rpId);
    if (!siteId) throw new NotFoundError('РП', rpId);
    const siteIds = await resolveSiteScope(user.id, user.role, user.allSites ?? false);
    if (siteIds !== null && !siteIds.includes(siteId)) {
      throw new NotFoundError('РП', rpId);
    }
  }

  /* ---------- GET /api/rp — реестр РП ---------- */
  fastify.get('/api/rp', adminOrUser, async (request) => {
    const user = request.user!;
    const siteIds = await resolveSiteScope(user.id, user.role, user.allSites ?? false);
    return getRepo().listRegistry(siteIds);
  });

  /* ---------- GET /api/rp/documents — документы для модалки ---------- */
  fastify.get('/api/rp/documents', adminOrUser, async (request) => {
    const q = rpDocumentsQuerySchema.parse(request.query);
    return getRepo().getDocuments(q.supplierId, q.counterpartyId, q.siteId);
  });

  /* ---------- POST /api/rp — создать РП (опционально с письмом PayHub) ---------- */
  fastify.post('/api/rp', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const body = createRpBodySchema.parse(request.body);
    const letterInitialStatus = body.letter?.hasAttachments ? 'uploading' : 'pending';
    const row = await getRepo().create({
      supplierId: body.supplierId,
      counterpartyId: body.counterpartyId,
      siteId: body.siteId,
      paymentRequestIds: body.paymentRequestIds,
      documents: body.documents,
      letterDate: body.letterDate ?? null,
      createdBy: user.id,
      letter: body.letter
        ? {
            subject: body.letter.subject,
            content: body.letter.content,
            responsiblePersonName: body.letter.responsiblePersonName ?? null,
          }
        : null,
      letterInitialStatus,
    });
    // Без файлов — задача синхронизации ставится сразу; с файлами — после finalize.
    // Сбой постановки в очередь (Redis) не откатывает уже созданную РП: письмо
    // останется в статусе pending и будет подхвачено sweep-задачей воркера.
    if (body.letter && letterInitialStatus === 'pending') {
      try {
        await enqueueRpLetterSync(row.id);
      } catch (err) {
        request.log.error(
          { err, rpLetterId: row.id },
          'РП создана, но постановка письма в очередь не удалась (подхватит sweep)',
        );
      }
    }
    return reply.status(201).send(row);
  });

  /* ---------- POST /api/rp/:id/letter/attachments — регистрация файлов письма ---------- */
  fastify.post('/api/rp/:id/letter/attachments', adminOrUser, async (request) => {
    const { id } = rpIdParamsSchema.parse(request.params);
    const body = rpLetterAttachmentsBodySchema.parse(request.body);
    await assertRpInScope(id, request.user!);
    // Файлы должны быть загружены чанковым аплоадом в папку ИМЕННО этой РП —
    // нельзя привязать произвольный ключ billhub S3 (чужие документы) к письму.
    const prefix = `rp-letters/${id}/`;
    for (const a of body.attachments) {
      if (!a.fileKey.startsWith(prefix)) {
        throw new ValidationError('Файл не принадлежит этой РП');
      }
    }
    await getRepo().addLetterAttachments(
      id,
      body.attachments.map((a) => ({
        fileKey: a.fileKey,
        fileName: sanitizeAttachmentName(a.fileName),
        mimeType: a.mimeType ?? null,
        sizeBytes: a.sizeBytes ?? null,
      })),
    );
    return { success: true };
  });

  /* ---------- POST /api/rp/:id/letter/finalize — поставить письмо в очередь ---------- */
  /* Используется и как завершение загрузки файлов, и как ручной «Повторить» после failed. */
  fastify.post('/api/rp/:id/letter/finalize', adminOrUser, async (request) => {
    const { id } = rpIdParamsSchema.parse(request.params);
    await assertRpInScope(id, request.user!);
    await getRepo().finalizeLetter(id);
    await enqueueRpLetterSync(id);
    return { success: true };
  });

  /* ---------- PATCH /api/rp/:id/status — смена статуса РП ---------- */
  fastify.patch('/api/rp/:id/status', adminOrUser, async (request) => {
    const { id } = rpIdParamsSchema.parse(request.params);
    const body = updateRpStatusBodySchema.parse(request.body);
    await assertRpInScope(id, request.user!);
    await getRepo().updateStatus(id, body.status);
    return { success: true };
  });
}

export default rpRoutes;
