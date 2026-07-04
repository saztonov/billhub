import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createConstructionSiteBodySchema,
  updateConstructionSiteBodySchema,
  type ConstructionSite,
} from '../../schemas/reference.js';

/**
 * Убирает поля сопоставления PayHub из объекта для роли counterparty_user
 * (внешний пользователь не должен видеть внутреннюю привязку к PayHub).
 * Для admin/user поля отдаются как есть.
 */
function stripPayhubForRole(site: ConstructionSite, role: string | undefined): ConstructionSite {
  if (role !== 'counterparty_user') return site;
  const {
    payhubProjectId: _pid,
    payhubProjectCode: _pcode,
    payhubProjectName: _pname,
    payhubContractorId: _cid,
    payhubContractorName: _cname,
    payhubContractorInn: _cinn,
    ...rest
  } = site;
  return rest as ConstructionSite;
}

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
      const sites = await request.server.repos.references.listConstructionSites();
      return sites.map((site) => stripPayhubForRole(site, request.user?.role));
    },
  );

  /** GET /api/references/construction-sites/:id — один объект */
  fastify.get<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request) => {
      const site = await request.server.repos.references.getConstructionSite(request.params.id);
      return stripPayhubForRole(site, request.user?.role);
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
