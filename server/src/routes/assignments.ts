import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { createAssignmentBodySchema } from '../schemas/assignment.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов назначений (через fastify.repos.assignments)      */
/* ------------------------------------------------------------------ */

async function assignmentRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };
  const anyAuthenticated = {
    preHandler: [authenticate, requireRole('admin', 'user', 'counterparty_user')],
  };

  /* ---------- GET /api/assignments/payment-request/:requestId/current ---------- */
  fastify.get(
    '/api/assignments/payment-request/:requestId/current',
    anyAuthenticated,
    async (request) => {
      const { requestId } = request.params as { requestId: string };
      return request.server.repos.assignments.getCurrent(requestId);
    },
  );

  /* ---------- GET /api/assignments/payment-request/:requestId ---------- */
  fastify.get('/api/assignments/payment-request/:requestId', anyAuthenticated, async (request) => {
    const { requestId } = request.params as { requestId: string };
    return request.server.repos.assignments.listByRequest(requestId);
  });

  /* ---------- POST /api/assignments ---------- */
  fastify.post('/api/assignments', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const body = createAssignmentBodySchema.parse(request.body);
    await request.server.repos.assignments.create({
      paymentRequestId: body.paymentRequestId,
      assignedUserId: body.assignedUserId,
      assignedByUserId: user.id,
    });
    return reply.status(201).send({ success: true });
  });

  /* ---------- GET /api/assignments/omts-users ---------- */
  fastify.get('/api/assignments/omts-users', adminOrUser, async (request) => {
    return request.server.repos.assignments.listOmtsUsers();
  });
}

export default assignmentRoutes;
