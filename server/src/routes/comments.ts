import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import {
  createPaymentCommentBodySchema,
  createContractCommentBodySchema,
  updateCommentBodySchema,
} from '../schemas/comment.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов комментариев (через fastify.repos)               */
/* ------------------------------------------------------------------ */

async function commentRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticate] };

  /* ================================================================ */
  /*  Комментарии к заявкам на оплату (payment_request_comments)       */
  /* ================================================================ */

  fastify.get('/api/comments/payment-request/:requestId', auth, async (request) => {
    const { requestId } = request.params as { requestId: string };
    return request.server.repos.comments.listPaymentComments(requestId);
  });

  fastify.post('/api/comments/payment-request', auth, async (request, reply) => {
    const body = createPaymentCommentBodySchema.parse(request.body);
    await request.server.repos.comments.createPaymentComment(request.user!.id, body);
    return reply.status(201).send({ success: true });
  });

  fastify.put('/api/comments/:id', auth, async (request) => {
    const { id } = request.params as { id: string };
    const { text } = updateCommentBodySchema.parse(request.body);
    await request.server.repos.comments.updatePaymentComment(id, text);
    return { success: true };
  });

  fastify.delete('/api/comments/:id', auth, async (request) => {
    const { id } = request.params as { id: string };
    await request.server.repos.comments.deletePaymentComment(id);
    return { success: true };
  });

  fastify.post('/api/comments/payment-request/:requestId/mark-read', auth, async (request) => {
    const { requestId } = request.params as { requestId: string };
    await request.server.repos.comments.markReadPayment(request.user!.id, requestId);
    return { success: true };
  });

  fastify.get('/api/comments/payment-request/unread-counts', auth, async (request) => {
    return request.server.repos.comments.unreadCountsPayment(request.user!.id);
  });

  /* ================================================================ */
  /*  Комментарии к заявкам на договор (contract_request_comments)     */
  /* ================================================================ */

  fastify.get('/api/comments/contract-request/:requestId', auth, async (request) => {
    const { requestId } = request.params as { requestId: string };
    return request.server.repos.comments.listContractComments(requestId);
  });

  fastify.post('/api/comments/contract-request', auth, async (request, reply) => {
    const body = createContractCommentBodySchema.parse(request.body);
    await request.server.repos.comments.createContractComment(request.user!.id, body);
    return reply.status(201).send({ success: true });
  });

  fastify.put('/api/comments/contract-request/:id', auth, async (request) => {
    const { id } = request.params as { id: string };
    const { text } = updateCommentBodySchema.parse(request.body);
    await request.server.repos.comments.updateContractComment(id, text);
    return { success: true };
  });

  /** Алиас: фронтенд вызывает /api/comments/contract/:id */
  fastify.put('/api/comments/contract/:id', auth, async (request) => {
    const { id } = request.params as { id: string };
    const { text } = updateCommentBodySchema.parse(request.body);
    await request.server.repos.comments.updateContractComment(id, text);
    return { success: true };
  });

  fastify.delete('/api/comments/contract-request/:id', auth, async (request) => {
    const { id } = request.params as { id: string };
    await request.server.repos.comments.deleteContractComment(id);
    return { success: true };
  });

  /** Алиас: фронтенд вызывает /api/comments/contract/:id */
  fastify.delete('/api/comments/contract/:id', auth, async (request) => {
    const { id } = request.params as { id: string };
    await request.server.repos.comments.deleteContractComment(id);
    return { success: true };
  });

  fastify.post('/api/comments/contract-request/:requestId/mark-read', auth, async (request) => {
    const { requestId } = request.params as { requestId: string };
    await request.server.repos.comments.markReadContract(request.user!.id, requestId);
    return { success: true };
  });

  fastify.get('/api/comments/contract-request/unread-counts', auth, async (request) => {
    return request.server.repos.comments.unreadCountsContract(request.user!.id);
  });
}

export default commentRoutes;
