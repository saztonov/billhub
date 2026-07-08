import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { rpStageAssigneeBodySchema } from '../schemas/rp-stage.js';

/* ------------------------------------------------------------------ */
/*  Маршруты назначений этапа «РП» (через fastify.repos.rpStage)       */
/* ------------------------------------------------------------------ */

async function rpStageRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: [authenticate, requireRole('admin')] };
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /* ---------- GET /api/rp-stage/assignees ---------- */
  fastify.get('/api/rp-stage/assignees', adminOnly, async (request) => {
    return request.server.repos.rpStage.listAssignees();
  });

  /* ---------- POST /api/rp-stage/assignees ---------- */
  fastify.post('/api/rp-stage/assignees', adminOnly, async (request, reply) => {
    const body = rpStageAssigneeBodySchema.parse(request.body);
    await request.server.repos.rpStage.addAssignee(body.siteId, body.userId);
    return reply.status(201).send({ success: true });
  });

  /* ---------- DELETE /api/rp-stage/assignees/:id ---------- */
  fastify.delete('/api/rp-stage/assignees/:id', adminOnly, async (request) => {
    const { id } = request.params as { id: string };
    await request.server.repos.rpStage.removeAssignee(id);
    return { success: true };
  });

  /* ---------- GET /api/rp-stage/candidates ---------- */
  fastify.get('/api/rp-stage/candidates', adminOnly, async (request) => {
    return request.server.repos.rpStage.listCandidates();
  });

  /* ---------- GET /api/rp-stage/my ---------- */
  // Объекты, на которые назначен текущий пользователь (пусто — не назначенец РП).
  fastify.get('/api/rp-stage/my', adminOrUser, async (request) => {
    const user = request.user!;
    const siteIds = await request.server.repos.rpStage.getAssigneeSiteIds(user.id);
    return { siteIds };
  });
}

export default rpStageRoutes;
