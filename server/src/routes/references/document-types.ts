import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createDocumentTypeBodySchema,
  updateDocumentTypeBodySchema,
} from '../../schemas/reference.js';

/* ------------------------------------------------------------------ */
/*  Параметры пути и query                                             */
/* ------------------------------------------------------------------ */

interface DocumentTypeQuery {
  category?: string;
}

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

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов типов документов (через fastify.repos)            */
/* ------------------------------------------------------------------ */

async function documentTypeRoutes(fastify: FastifyInstance): Promise<void> {
  /** GET /api/references/document-types — список типов документов */
  fastify.get<{ Querystring: DocumentTypeQuery }>(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'user', 'counterparty_user')] },
    async (request) => {
      return request.server.repos.references.listDocumentTypes(request.query.category);
    },
  );

  /** POST /api/references/document-types — создание типа документа */
  fastify.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (request) => {
    const body = createDocumentTypeBodySchema.parse(request.body);
    return request.server.repos.references.createDocumentType(body);
  });

  /** PUT /api/references/document-types/:id — обновление типа документа */
  fastify.put<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const body = updateDocumentTypeBodySchema.parse(request.body);
      return request.server.repos.references.updateDocumentType(request.params.id, body);
    },
  );

  /** DELETE /api/references/document-types/:id — удаление типа документа */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      await request.server.repos.references.deleteDocumentType(request.params.id);
      return { success: true };
    },
  );
}

export default documentTypeRoutes;
