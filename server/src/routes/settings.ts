import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { ocrModelBodySchema, ocrModelSetActiveBodySchema } from '../schemas/ocr-model.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов настроек (OCR-модели) — через fastify.repos.ocrModels */
/* ------------------------------------------------------------------ */

async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: [authenticate, requireRole('admin')] };

  /** GET /api/settings/ocr-models — список OCR-моделей */
  fastify.get('/ocr-models', adminOnly, async (request) => {
    return request.server.repos.ocrModels.list();
  });

  /** POST /api/settings/ocr-models — добавление OCR-модели */
  fastify.post('/ocr-models', adminOnly, async (request, reply) => {
    const body = ocrModelBodySchema.parse(request.body);
    const data = await request.server.repos.ocrModels.create(body);
    return reply.send(data);
  });

  /** DELETE /api/settings/ocr-models/:id — удаление OCR-модели */
  fastify.delete('/ocr-models/:id', adminOnly, async (request) => {
    const { id } = request.params as { id: string };
    await request.server.repos.ocrModels.delete(id);
    return { success: true };
  });

  /** PUT /api/settings/ocr-models/:id/activate — активация модели (ID в URL) */
  fastify.put('/ocr-models/:id/activate', adminOnly, async (request) => {
    const { id } = request.params as { id: string };
    return request.server.repos.ocrModels.setActive(id);
  });

  /** PUT /api/settings/ocr-models/set-active — установка активной модели (ID в теле) */
  fastify.put('/ocr-models/set-active', adminOnly, async (request) => {
    const body = ocrModelSetActiveBodySchema.parse(request.body);
    return request.server.repos.ocrModels.setActive(body.id);
  });
}

export default settingsRoutes;
