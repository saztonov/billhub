import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { createFieldOptionBodySchema, updateFieldOptionBodySchema } from '../schemas/reference.js';

/* ------------------------------------------------------------------ */
/*  Параметры пути и query                                             */
/* ------------------------------------------------------------------ */

interface FieldOptionQuery {
  fieldCode?: string;
}

interface IdParams {
  id: string;
}

const querySchema = {
  querystring: {
    type: 'object' as const,
    properties: { fieldCode: { type: 'string' as const } },
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
/*  Плагин маршрутов опций полей заявок (через fastify.repos)          */
/* ------------------------------------------------------------------ */

async function fieldOptionRoutes(fastify: FastifyInstance): Promise<void> {
  /** GET /api/references/field-options — список опций (с фильтром по fieldCode) */
  fastify.get<{ Querystring: FieldOptionQuery }>(
    '/',
    {
      schema: querySchema,
      preHandler: [authenticate, requireRole('admin', 'user', 'counterparty_user')],
    },
    async (request) => {
      return request.server.repos.references.listFieldOptions(request.query.fieldCode);
    },
  );

  /** POST /api/references/field-options — создание опции */
  fastify.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (request) => {
    const body = createFieldOptionBodySchema.parse(request.body);
    return request.server.repos.references.createFieldOption(body);
  });

  /** PUT /api/references/field-options/:id — обновление опции */
  fastify.put<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const body = updateFieldOptionBodySchema.parse(request.body);
      return request.server.repos.references.updateFieldOption(request.params.id, body);
    },
  );

  /** DELETE /api/references/field-options/:id — удаление опции */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      await request.server.repos.references.deleteFieldOption(request.params.id);
      return { success: true };
    },
  );
}

export default fieldOptionRoutes;
