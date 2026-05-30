import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createCostTypeBodySchema, updateCostTypeBodySchema } from '../../schemas/reference.js';
import { nonEmptyString } from '../../schemas/common.js';

/* ------------------------------------------------------------------ */
/*  Параметры пути и тела                                              */
/* ------------------------------------------------------------------ */

interface IdParams {
  id: string;
}

const idParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'],
    properties: { id: { type: 'string' as const, minLength: 1 } },
  },
};

const batchImportBodySchema = z.object({ names: z.array(nonEmptyString).min(1) });

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов видов затрат (через fastify.repos)                */
/* ------------------------------------------------------------------ */

async function costTypeRoutes(fastify: FastifyInstance): Promise<void> {
  /** GET /api/references/cost-types — список видов затрат */
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request) => {
      return request.server.repos.references.listCostTypes();
    },
  );

  /** POST /api/references/cost-types — создание вида затрат */
  fastify.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (request) => {
    const body = createCostTypeBodySchema.parse(request.body);
    return request.server.repos.references.createCostType(body);
  });

  /** PUT /api/references/cost-types/:id — обновление вида затрат */
  fastify.put<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const body = updateCostTypeBodySchema.parse(request.body);
      return request.server.repos.references.updateCostType(request.params.id, body);
    },
  );

  /** DELETE /api/references/cost-types/:id — удаление вида затрат */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      await request.server.repos.references.deleteCostType(request.params.id);
      return { success: true };
    },
  );

  /** POST /api/references/cost-types/batch-import — пакетный импорт */
  fastify.post(
    '/batch-import',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const { names } = batchImportBodySchema.parse(request.body);
      const created = await request.server.repos.references.batchCreateCostTypes(names);
      return { created };
    },
  );
}

export default costTypeRoutes;
