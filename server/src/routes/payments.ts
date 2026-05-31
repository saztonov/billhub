import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  createPaymentParamBodySchema,
  createPaymentBodySchema,
  updatePaymentBodySchema,
  addPaymentFileBodySchema,
} from '../schemas/payment.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов оплат (через fastify.repos)                       */
/* ------------------------------------------------------------------ */

async function paymentRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };
  const anyAuthenticated = {
    preHandler: [authenticate, requireRole('admin', 'user', 'counterparty_user')],
  };

  /* ---------- GET (payment-request/:requestId и :paymentRequestId — алиасы) ---------- */
  fastify.get('/api/payments/payment-request/:requestId', anyAuthenticated, async (request) => {
    const { requestId } = request.params as { requestId: string };
    return request.server.repos.payments.listByPaymentRequest(requestId);
  });
  fastify.get('/api/payments/:paymentRequestId', anyAuthenticated, async (request) => {
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    return request.server.repos.payments.listByPaymentRequest(paymentRequestId);
  });

  /* ---------- POST /api/payments/:paymentRequestId (алиас, id из URL) ---------- */
  fastify.post('/api/payments/:paymentRequestId', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    const body = createPaymentParamBodySchema.parse(request.body);
    const result = await request.server.repos.payments.create({
      paymentRequestId,
      paymentDate: body.paymentDate,
      amount: body.amount,
      createdBy: user.id,
    });
    return reply.status(201).send({ id: result.id });
  });

  /* ---------- POST /api/payments (id из тела) ---------- */
  fastify.post('/api/payments', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const body = createPaymentBodySchema.parse(request.body);
    const result = await request.server.repos.payments.create({
      paymentRequestId: body.paymentRequestId,
      paymentDate: body.paymentDate,
      amount: body.amount,
      createdBy: user.id,
    });
    return reply.status(201).send({ id: result.id });
  });

  /* ---------- PUT /:id и item/:id (алиасы) ---------- */
  const updateHandler = async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const body = updatePaymentBodySchema.parse(request.body);
    await request.server.repos.payments.update(id, body, request.user!.id);
    return { success: true };
  };
  fastify.put('/api/payments/:id', adminOrUser, updateHandler);
  fastify.put('/api/payments/item/:id', adminOrUser, updateHandler);

  /* ---------- DELETE /:id и item/:id (алиасы) ---------- */
  const deleteHandler = async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    await request.server.repos.payments.delete(id);
    return { success: true };
  };
  fastify.delete('/api/payments/:id', adminOrUser, deleteHandler);
  fastify.delete('/api/payments/item/:id', adminOrUser, deleteHandler);

  /* ---------- POST /:id/files и item/:paymentId/files (алиасы) ---------- */
  fastify.post('/api/payments/:id/files', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = addPaymentFileBodySchema.parse(request.body);
    await request.server.repos.payments.addFile(id, body, request.user!.id);
    return reply.status(201).send({ success: true });
  });
  fastify.post('/api/payments/item/:paymentId/files', adminOrUser, async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string };
    const body = addPaymentFileBodySchema.parse(request.body);
    await request.server.repos.payments.addFile(paymentId, body, request.user!.id);
    return reply.status(201).send({ success: true });
  });

  /* ---------- POST /api/payments/:paymentRequestId/recalc-status ---------- */
  fastify.post('/api/payments/:paymentRequestId/recalc-status', adminOrUser, async (request) => {
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    return request.server.repos.payments.recalcStatus(paymentRequestId);
  });

  /* ---------- DELETE /api/payments/files/:id ---------- */
  fastify.delete('/api/payments/files/:id', adminOrUser, async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { paymentId?: string };
    await request.server.repos.payments.deleteFile(id, query.paymentId);
    return { success: true };
  });
}

export default paymentRoutes;
