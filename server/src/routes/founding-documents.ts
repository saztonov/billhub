import type { FastifyInstance } from 'fastify';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  updateFoundingDocBodySchema,
  foundingGeneralCommentBodySchema,
} from '../schemas/founding-document.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов учредительных документов (через fastify.repos)    */
/* ------------------------------------------------------------------ */

async function foundingDocumentRoutes(fastify: FastifyInstance): Promise<void> {
  const opts = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /* ---------- GET /:supplierId — таблица учредительных документов ---------- */
  fastify.get('/:supplierId', opts, async (request) => {
    const { supplierId } = request.params as { supplierId: string };
    return request.server.repos.foundingDocuments.getTable(supplierId);
  });

  /* ---------- PUT /:supplierId/:typeId — upsert записи ---------- */
  fastify.put('/:supplierId/:typeId', opts, async (request) => {
    const { supplierId, typeId } = request.params as { supplierId: string; typeId: string };
    const body = updateFoundingDocBodySchema.parse(request.body);
    return request.server.repos.foundingDocuments.upsert(
      supplierId,
      typeId,
      body,
      request.user!.id,
    );
  });

  /* ---------- GET /:supplierId/general-comment ---------- */
  fastify.get('/:supplierId/general-comment', opts, async (request, reply) => {
    const { supplierId } = request.params as { supplierId: string };
    const result = await request.server.repos.foundingDocuments.getGeneralComment(supplierId);
    if (!result) return reply.status(404).send({ error: 'Поставщик не найден' });
    return result;
  });

  /* ---------- PUT /:supplierId/general-comment ---------- */
  fastify.put('/:supplierId/general-comment', opts, async (request) => {
    const { supplierId } = request.params as { supplierId: string };
    const body = foundingGeneralCommentBodySchema.parse(request.body);
    await request.server.repos.foundingDocuments.setGeneralComment(supplierId, body.comment);
    return { success: true };
  });

  /* ---------- GET /:supplierId/:typeId/files ---------- */
  fastify.get('/:supplierId/:typeId/files', opts, async (request) => {
    const { supplierId, typeId } = request.params as { supplierId: string; typeId: string };
    return request.server.repos.foundingDocuments.listFiles(supplierId, typeId);
  });

  /* ---------- DELETE /files/:fileId — удаление файла (S3 + БД) ---------- */
  fastify.delete('/files/:fileId', opts, async (request, reply) => {
    const { fileId } = request.params as { fileId: string };

    const file = await request.server.repos.foundingDocuments.getFileForDeletion(fileId);
    if (!file) return reply.status(404).send({ error: 'Файл не найден' });

    // Удаляем из S3 (best-effort — БД-удаление выполняется в любом случае)
    try {
      await fastify.s3Client.send(
        new DeleteObjectCommand({ Bucket: fastify.s3Bucket, Key: file.fileKey }),
      );
    } catch (err) {
      request.log.warn({ err, fileKey: file.fileKey }, 'Не удалось удалить файл из S3');
    }

    await request.server.repos.foundingDocuments.deleteFile(fileId);
    return { success: true };
  });
}

export default foundingDocumentRoutes;
