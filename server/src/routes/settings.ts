import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Типы                                                               */
/* ------------------------------------------------------------------ */

interface OcrModelBody {
  modelId: string;
  modelName: string;
  isActive?: boolean;
}

interface SetActiveBody {
  id: string;
}

interface IdParams {
  id: string;
}

/* ------------------------------------------------------------------ */
/*  JSON-схемы валидации                                               */
/* ------------------------------------------------------------------ */

const ocrModelSchema = {
  body: {
    type: 'object' as const,
    required: ['modelId', 'modelName'],
    properties: {
      modelId: { type: 'string' as const, minLength: 1 },
      modelName: { type: 'string' as const, minLength: 1 },
      isActive: { type: 'boolean' as const },
    },
    additionalProperties: false,
  },
};

const setActiveSchema = {
  body: {
    type: 'object' as const,
    required: ['id'],
    properties: {
      id: { type: 'string' as const, minLength: 1 },
    },
    additionalProperties: false,
  },
};

const idParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'],
    properties: { id: { type: 'string' as const, minLength: 1 } },
  },
};

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов настроек (OCR-модели)                             */
/* ------------------------------------------------------------------ */

async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  const SELECT_FIELDS = 'id, model_id, model_name, is_active, created_at';

  /** GET /api/settings/ocr-models — список OCR-моделей */
  fastify.get(
    '/ocr-models',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { data, error } = await request.server.supabase
        .from('ocr_models')
        .select(SELECT_FIELDS)
        .order('created_at', { ascending: false });
      if (error) return reply.status(500).send({ error: error.message });
      return data;
    }
  );

  /** POST /api/settings/ocr-models — добавление OCR-модели */
  fastify.post<{ Body: OcrModelBody }>(
    '/ocr-models',
    { schema: ocrModelSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { modelId, modelName, isActive } = request.body;
      const { data, error } = await request.server.supabase
        .from('ocr_models')
        .insert({
          model_id: modelId,
          model_name: modelName,
          is_active: isActive ?? false,
        })
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** DELETE /api/settings/ocr-models/:id — удаление OCR-модели */
  fastify.delete<{ Params: IdParams }>(
    '/ocr-models/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { error } = await request.server.supabase
        .from('ocr_models')
        .delete()
        .eq('id', id);
      if (error) return reply.status(400).send({ error: error.message });
      return { success: true };
    }
  );

  /** PUT /api/settings/ocr-models/set-active — установка активной модели */
  fastify.put<{ Body: SetActiveBody }>(
    '/ocr-models/set-active',
    { schema: setActiveSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.body;

      // Деактивируем все модели
      const { error: deactivateError } = await request.server.supabase
        .from('ocr_models')
        .update({ is_active: false })
        .neq('id', '');
      if (deactivateError) return reply.status(500).send({ error: deactivateError.message });

      // Активируем выбранную
      const { data, error } = await request.server.supabase
        .from('ocr_models')
        .update({ is_active: true })
        .eq('id', id)
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );
}

export default settingsRoutes;
