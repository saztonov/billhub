import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { omtsRpSitesBodySchema, omtsRpResponsibleBodySchema } from '../schemas/omts-rp.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов настроек ОМТС РП (через fastify.repos.omtsRp)     */
/* ------------------------------------------------------------------ */

async function omtsRpRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: [authenticate, requireRole('admin')] };
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /** Пропускает admin или сотрудника ОМТС */
  async function requireAdminOrOmts(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = request.user;
    if (!user) {
      reply.status(401).send({ error: 'Не авторизован' });
      return;
    }
    if (user.role === 'admin' || user.department === 'omts') return;

    reply.status(403).send({ error: 'Доступ запрещён' });
    return;
  }

  const adminOrOmts = { preHandler: [authenticate, requireAdminOrOmts] };

  /* ---------- GET /api/omts-rp/config ---------- */
  fastify.get('/api/omts-rp/config', adminOrUser, async (request) => {
    const responsibleUserId = await request.server.repos.omtsRp.getResponsibleUserId();
    return { responsibleUserId };
  });

  /* ---------- GET /api/omts-rp/sites ---------- */
  fastify.get('/api/omts-rp/sites', adminOrOmts, async (request) => {
    return request.server.repos.omtsRp.getSites();
  });

  /* ---------- PUT /api/omts-rp/sites ---------- */
  fastify.put('/api/omts-rp/sites', adminOnly, async (request) => {
    const body = omtsRpSitesBodySchema.parse(request.body);
    await request.server.repos.omtsRp.updateSites(body.action, body.siteId);
    return { success: true };
  });

  /* ---------- GET /api/omts-rp/responsible ---------- */
  fastify.get('/api/omts-rp/responsible', adminOnly, async (request) => {
    const responsibleUserId = await request.server.repos.omtsRp.getResponsibleUserId();
    return { responsibleUserId };
  });

  /* ---------- PUT /api/omts-rp/responsible ---------- */
  fastify.put('/api/omts-rp/responsible', adminOnly, async (request) => {
    const body = omtsRpResponsibleBodySchema.parse(request.body);
    await request.server.repos.omtsRp.setResponsibleUserId(body.userId);
    return { success: true };
  });

  /* ---------- GET /api/omts-rp/omts-users ---------- */
  fastify.get('/api/omts-rp/omts-users', adminOnly, async (request) => {
    return request.server.repos.assignments.listOmtsUsers();
  });
}

export default omtsRpRoutes;
