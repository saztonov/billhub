import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createStatusBodySchema, updateStatusBodySchema } from '../../schemas/reference.js';

/* ------------------------------------------------------------------ */
/*  Параметры пути и query                                             */
/* ------------------------------------------------------------------ */

interface StatusQuery {
  entityType: string;
}

interface IdParams {
  id: string;
}

const querySchema = {
  querystring: {
    type: 'object' as const,
    required: ['entityType'],
    properties: { entityType: { type: 'string' as const, minLength: 1 } },
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
/*  Плагин маршрутов статусов (через fastify.repos)                    */
/* ------------------------------------------------------------------ */

async function statusRoutes(fastify: FastifyInstance): Promise<void> {
  /** GET /api/references/statuses?entityType=xxx — статусы по типу сущности */
  fastify.get<{ Querystring: StatusQuery }>(
    '/',
    {
      schema: querySchema,
      preHandler: [authenticate, requireRole('admin', 'user', 'counterparty_user')],
    },
    async (request) => {
      return request.server.repos.references.listStatuses(request.query.entityType);
    },
  );

  /** POST /api/references/statuses — создание статуса */
  fastify.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (request) => {
    const body = createStatusBodySchema.parse(request.body);
    return request.server.repos.references.createStatus(body);
  });

  /** PUT /api/references/statuses/:id — обновление статуса */
  fastify.put<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const body = updateStatusBodySchema.parse(request.body);
      return request.server.repos.references.updateStatus(request.params.id, body);
    },
  );

  /** DELETE /api/references/statuses/:id — удаление статуса */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      await request.server.repos.references.deleteStatus(request.params.id);
      return { success: true };
    },
  );
}

export default statusRoutes;
