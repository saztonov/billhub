import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createConstructionSiteBodySchema,
  updateConstructionSiteBodySchema,
} from '../../schemas/reference.js';

/* ------------------------------------------------------------------ */
/*  Параметры пути                                                     */
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

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов объектов строительства (через fastify.repos)      */
/* ------------------------------------------------------------------ */

async function constructionSiteRoutes(fastify: FastifyInstance): Promise<void> {
  /** GET /api/references/construction-sites — список объектов */
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'user', 'counterparty_user')] },
    async (request) => {
      return request.server.repos.references.listConstructionSites();
    },
  );

  /** GET /api/references/construction-sites/:id — один объект */
  fastify.get<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request) => {
      return request.server.repos.references.getConstructionSite(request.params.id);
    },
  );

  /** POST /api/references/construction-sites — создание объекта */
  fastify.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (request) => {
    const body = createConstructionSiteBodySchema.parse(request.body);
    return request.server.repos.references.createConstructionSite(body);
  });

  /** PUT /api/references/construction-sites/:id — обновление объекта */
  fastify.put<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const body = updateConstructionSiteBodySchema.parse(request.body);
      return request.server.repos.references.updateConstructionSite(request.params.id, body);
    },
  );

  /** DELETE /api/references/construction-sites/:id — удаление объекта */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      await request.server.repos.references.deleteConstructionSite(request.params.id);
      return { success: true };
    },
  );
}

export default constructionSiteRoutes;
