import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  setStatusBodySchema,
  dpDataBodySchema,
  setFileRejectionBodySchema,
  addPaymentRequestFileBodySchema,
} from '../schemas/payment-request.js';

/* ------------------------------------------------------------------ */
/*  Дополнительные маршруты заявок на оплату (через fastify.repos)     */
/* ------------------------------------------------------------------ */

async function paymentRequestExtraRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticate] };
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /* ---------- PATCH /api/payment-requests/:id/status ---------- */
  fastify.patch('/api/payment-requests/:id/status', adminOrUser, async (request) => {
    const { id } = request.params as { id: string };
    const body = setStatusBodySchema.parse(request.body);
    await request.server.repos.paymentRequests.setStatus(id, body.statusId);
    return { success: true };
  });

  /* ---------- PATCH /api/payment-requests/:id/dp ---------- */
  fastify.patch('/api/payment-requests/:id/dp', adminOrUser, async (request) => {
    const { id } = request.params as { id: string };
    const body = dpDataBodySchema.parse(request.body);
    await request.server.repos.paymentRequests.setDpData(id, body);
    return { success: true };
  });

  /* ---------- PATCH /api/payment-requests/files/:fileId/rejection ---------- */
  fastify.patch('/api/payment-requests/files/:fileId/rejection', adminOrUser, async (request) => {
    const { fileId } = request.params as { fileId: string };
    const body = setFileRejectionBodySchema.parse(request.body);
    await request.server.repos.paymentRequests.setFileRejection(
      fileId,
      body.isRejected,
      body.isRejected ? body.userId : null,
    );
    return { success: true, isRejected: body.isRejected };
  });

  /* ---------- POST /api/payment-requests/:id/files ---------- */
  fastify.post('/api/payment-requests/:id/files', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = addPaymentRequestFileBodySchema.parse(request.body);
    await request.server.repos.paymentRequests.addFile(id, body);
    return reply.status(201).send({ success: true });
  });

  /* ---------- GET /api/payment-requests/:id/number ---------- */
  fastify.get('/api/payment-requests/:id/number', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const requestNumber = await request.server.repos.paymentRequests.getRequestNumber(id);
    if (requestNumber === null) return reply.status(404).send({ error: 'Заявка не найдена' });
    return reply.send({ requestNumber });
  });
}

export default paymentRequestExtraRoutes;
