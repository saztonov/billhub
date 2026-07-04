import type { FastifyInstance } from 'fastify';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { DrizzleRpRepository } from '../repositories/drizzle/rp.drizzle.js';
import { ValidationError, NotFoundError } from '../repositories/types.js';
import { enqueueRpLetterSync } from '../queues/index.js';
import { PayHubApiError } from '../services/payhub/payhub-errors.js';
import type { PayHubClient } from '../services/payhub/payhub-client.js';
import { createRpLetterStage1 } from '../services/rp/rp-letter-sync.js';
import type { RpLetterSyncDeps } from '../services/rp/rp-letter-sync.js';
import { getRpSenderSetting } from '../services/rp/rp-sender-setting.js';
import { createObservabilityLogger } from '../services/observability/logger.js';
import {
  createRpBodySchema,
  updateRpStatusBodySchema,
  rpDocumentsQuerySchema,
  rpLetterAttachmentsBodySchema,
  rpStage1BodySchema,
  finalizeLetterBodySchema,
  editLetterTextBodySchema,
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
  const stage1Log = createObservabilityLogger('rp-letter-stage1');

  /** Drizzle-инстанс БД (реестр РП реализован только на Drizzle). */
  function getDb() {
    const db = fastify.db;
    if (!db) {
      throw new Error(
        'РП-роуты требуют DB_PROVIDER=drizzle (fastify.db не инициализирован). ' +
          'Реестр РП реализован только на Drizzle.',
      );
    }
    return db;
  }

  let repoCache: DrizzleRpRepository | null = null;
  /** Ленивая инициализация: реестр РП реализован только на Drizzle (без Supabase). */
  function getRepo(): DrizzleRpRepository {
    if (repoCache) return repoCache;
    repoCache = new DrizzleRpRepository(getDb());
    return repoCache;
  }

  /** Зависимости синхронного создания письма (1 этап). downloadFile не используется. */
  function stage1Deps(): RpLetterSyncDeps {
    return {
      repo: getRepo(),
      payhub: fastify.payhub,
      getSender: () => getRpSenderSetting(getDb()),
      downloadFile: () =>
        Promise.reject(new Error('downloadFile не используется при создании письма (1 этап)')),
      log: stage1Log,
    };
  }

  /**
   * Строгое удаление письма в PayHub перед изменением/удалением РП.
   * 404 — уже удалено (ок); прочие ошибки прерывают операцию (РП не трогаем).
   */
  async function deletePayhubLetterStrict(payhub: PayHubClient, letterId: string): Promise<void> {
    try {
      await payhub.deleteLetter(letterId);
    } catch (err) {
      if (err instanceof PayHubApiError) {
        if (err.status === 404) return; // письмо уже удалено — продолжаем
        throw new ValidationError(`Не удалось удалить письмо в PayHub: ${err.message}`);
      }
      throw new ValidationError('Не удалось удалить письмо в PayHub (нет связи). Повторите позже.');
    }
  }

  /** Best-effort очистка staging-файлов billhub S3 (осиротевшие файлы низкориски). */
  async function deleteStagingFiles(fileKeys: string[]): Promise<void> {
    if (fileKeys.length === 0) return;
    const s3 = fastify.s3Client;
    const bucket = fastify.s3Bucket;
    if (!s3 || !bucket) return;
    await Promise.all(
      fileKeys.map((Key) =>
        s3
          .send(new DeleteObjectCommand({ Bucket: bucket, Key }))
          .catch((err: unknown) =>
            fastify.log.warn({ err, key: Key }, 'РП: не удалось удалить staging-файл'),
          ),
      ),
    );
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

  /* ---------- POST /api/rp/letter-stage1 — 1 этап: РП + синхронное письмо PayHub ---------- */
  fastify.post('/api/rp/letter-stage1', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const body = rpStage1BodySchema.parse(request.body);
    const repo = getRepo();

    // Создаём локальную РП со статусом uploading (без авто-enqueue): письмо оформляем
    // синхронно ниже, файлы регистрируются на 2 этапе.
    const row = await repo.create({
      supplierId: body.supplierId,
      counterpartyId: body.counterpartyId,
      siteId: body.siteId,
      paymentRequestIds: body.paymentRequestIds,
      documents: body.documents,
      letterDate: body.letterDate ?? null,
      createdBy: user.id,
      letter: {
        subject: body.letter.subject,
        content: body.letter.content,
        responsiblePersonName: body.letter.responsiblePersonName ?? null,
      },
      letterInitialStatus: 'uploading',
    });

    try {
      const result = await createRpLetterStage1(stage1Deps(), row.id);
      if (result.mode === 'sync') {
        const updated = (await repo.listRegistry(null)).find((r) => r.id === row.id) ?? row;
        return reply.status(201).send({
          mode: 'sync',
          rp: updated,
          regNumber: result.regNumber,
          url: result.url,
          qrSvgDataUrl: result.qrSvgDataUrl,
        });
      }
      // Конфигурация PayHub не готова — РП создана, письмо синхронизируется позже.
      // Фронт довершит РП старым путём (загрузка файлов -> finalize).
      return reply.status(201).send({ mode: 'async', rp: row, reason: result.reason });
    } catch (err) {
      // Не-fallback ошибка PayHub: откат локальной РП, чтобы повтор был чистым
      // (осиротевшее письмо, если оно создалось, удаляет сам createRpLetterStage1).
      await repo
        .deleteRp(row.id)
        .catch((e: unknown) =>
          request.log.error(
            { err: e, rpLetterId: row.id },
            'РП: откат после сбоя 1 этапа не удался',
          ),
        );
      if (err instanceof PayHubApiError) {
        throw new ValidationError(`PayHub: ${err.message}`);
      }
      throw err;
    }
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
  /* Используется как завершение 2 этапа (с актуальным текстом -> PATCH письма) и как
     ручной «Повторить»/«Создать письмо» из реестра (без тела). */
  fastify.post('/api/rp/:id/letter/finalize', adminOrUser, async (request) => {
    const { id } = rpIdParamsSchema.parse(request.params);
    const body = finalizeLetterBodySchema.parse(request.body ?? {});
    await assertRpInScope(id, request.user!);
    const repo = getRepo();

    // Актуальный текст со 2 этапа: перезаписываем письмо в PayHub (если уже создано)
    // и снимок в БД, затем ставим задачу догрузки вложений.
    if (body.letter) {
      const ctx = await repo.getRpMutationContext(id);
      if (ctx?.payhubLetterId && fastify.payhub) {
        try {
          await fastify.payhub.updateLetter(ctx.payhubLetterId, {
            subject: body.letter.subject,
            content: body.letter.content,
            responsible_person_name: body.letter.responsiblePersonName ?? undefined,
            letter_date: body.letter.letterDate ?? undefined,
          });
        } catch (err) {
          if (err instanceof PayHubApiError) {
            throw new ValidationError(`Не удалось обновить письмо в PayHub: ${err.message}`);
          }
          throw err;
        }
      }
      await repo.updateLetterText(id, body.letter.letterDate ?? null, {
        subject: body.letter.subject,
        content: body.letter.content,
        responsiblePersonName: body.letter.responsiblePersonName ?? null,
      });
    }

    await repo.finalizeLetter(id);
    await enqueueRpLetterSync(id);
    return { success: true };
  });

  /* ---------- PATCH /api/rp/:id/letter-text — правка текста письма из реестра ---------- */
  fastify.patch('/api/rp/:id/letter-text', adminOrUser, async (request) => {
    const { id } = rpIdParamsSchema.parse(request.params);
    const body = editLetterTextBodySchema.parse(request.body);
    await assertRpInScope(id, request.user!);
    const repo = getRepo();
    const ctx = await repo.getRpMutationContext(id);
    if (!ctx) throw new NotFoundError('РП', id);
    if (ctx.status === 'annulled') {
      throw new ValidationError('Аннулированную РП редактировать нельзя');
    }
    // Если письмо уже создано — правим и в PayHub; иначе только снимок (для будущей синхронизации).
    if (ctx.payhubLetterId && fastify.payhub) {
      try {
        await fastify.payhub.updateLetter(ctx.payhubLetterId, {
          subject: body.subject,
          content: body.content,
          responsible_person_name: body.responsiblePersonName ?? undefined,
          letter_date: body.letterDate ?? undefined,
        });
      } catch (err) {
        if (err instanceof PayHubApiError) {
          throw new ValidationError(`Не удалось обновить письмо в PayHub: ${err.message}`);
        }
        throw err;
      }
    }
    await repo.updateLetterText(id, body.letterDate ?? null, {
      subject: body.subject,
      content: body.content,
      responsiblePersonName: body.responsiblePersonName ?? null,
    });
    return { success: true };
  });

  /* ---------- POST /api/rp/:id/annul — аннулировать РП (удалить письмо в PayHub) ---------- */
  fastify.post('/api/rp/:id/annul', adminOrUser, async (request) => {
    const { id } = rpIdParamsSchema.parse(request.params);
    await assertRpInScope(id, request.user!);
    const repo = getRepo();
    const ctx = await repo.getRpMutationContext(id);
    if (!ctx) throw new NotFoundError('РП', id);
    if (ctx.status === 'annulled') throw new ValidationError('РП уже аннулирована');
    if (ctx.paymentStatus !== 'unpaid') {
      throw new ValidationError('Аннулировать можно только полностью неоплаченную РП');
    }
    // Инвариант: сначала строго удаляем письмо в PayHub, только потом меняем РП.
    if (ctx.payhubLetterId && fastify.payhub) {
      await deletePayhubLetterStrict(fastify.payhub, ctx.payhubLetterId);
    }
    await repo.annulRp(id);
    return { success: true };
  });

  /* ---------- DELETE /api/rp/:id — удалить РП (и письмо в PayHub) ---------- */
  fastify.delete('/api/rp/:id', adminOrUser, async (request) => {
    const { id } = rpIdParamsSchema.parse(request.params);
    await assertRpInScope(id, request.user!);
    const repo = getRepo();
    const ctx = await repo.getRpMutationContext(id);
    if (!ctx) throw new NotFoundError('РП', id);
    // Инвариант: строго удаляем письмо в PayHub до удаления локальной РП.
    if (ctx.payhubLetterId && fastify.payhub) {
      await deletePayhubLetterStrict(fastify.payhub, ctx.payhubLetterId);
    }
    await repo.deleteRp(id);
    await deleteStagingFiles(ctx.attachmentFileKeys);
    return { success: true };
  });

  /* ---------- PATCH /api/rp/:id/status — смена статуса РП (совместимость) ---------- */
  fastify.patch('/api/rp/:id/status', adminOrUser, async (request) => {
    const { id } = rpIdParamsSchema.parse(request.params);
    const body = updateRpStatusBodySchema.parse(request.body);
    await assertRpInScope(id, request.user!);
    await getRepo().updateStatus(id, body.status);
    return { success: true };
  });
}

export default rpRoutes;
