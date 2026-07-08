import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  approvalDecideBodySchema,
  approvalSendToRevisionBodySchema,
  approvalCompleteRevisionBodySchema,
  approvalDecisionFileBodySchema,
} from '../schemas/approval.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов согласований (через fastify.repos.approvals)      */
/* ------------------------------------------------------------------ */

async function approvalRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };
  const anyAuthenticated = {
    preHandler: [authenticate, requireRole('admin', 'user', 'counterparty_user')],
  };

  /* ---------- GET /api/approvals/payment-request/:requestId ---------- */
  fastify.get('/api/approvals/payment-request/:requestId', anyAuthenticated, async (request) => {
    const { requestId } = request.params as { requestId: string };
    return request.server.repos.approvals.listDecisionsByRequest(requestId);
  });

  /* ---------- GET /api/approvals/payment-request/:requestId/logs ---------- */
  fastify.get(
    '/api/approvals/payment-request/:requestId/logs',
    anyAuthenticated,
    async (request) => {
      const { requestId } = request.params as { requestId: string };
      return request.server.repos.approvals.listLogsByRequest(requestId);
    },
  );

  /* ---------- POST /api/approvals/decide ---------- */
  fastify.post('/api/approvals/decide', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const body = approvalDecideBodySchema.parse(request.body);
    const result = await request.server.repos.approvals.decide({
      paymentRequestId: body.paymentRequestId,
      department: body.department,
      action: body.action,
      comment: body.comment,
      userId: user.id,
      userDepartment: user.department ?? null,
      isAdmin: user.role === 'admin',
    });
    if (!result.ok) return reply.status(result.status).send({ error: result.error });
    if (body.action === 'reject') {
      return reply.send({
        success: true,
        decisionId: result.decisionId ?? null,
        requestNumber: result.requestNumber ?? '',
      });
    }
    return reply.send({ success: true });
  });

  /* ---------- POST /api/approvals/send-to-revision ---------- */
  fastify.post('/api/approvals/send-to-revision', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const body = approvalSendToRevisionBodySchema.parse(request.body);
    const result = await request.server.repos.approvals.sendToRevision(
      body.paymentRequestId,
      user.id,
      body.comment ?? '',
    );
    if (!result.ok) return reply.status(result.status).send({ error: result.error });
    return reply.send({ success: true });
  });

  /* ---------- POST /api/approvals/complete-revision ---------- */
  fastify.post(
    '/api/approvals/complete-revision',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const body = approvalCompleteRevisionBodySchema.parse(request.body);
      const result = await request.server.repos.approvals.completeRevision(
        body.paymentRequestId,
        user.id,
        body.fieldUpdates,
      );
      if (!result.ok) return reply.status(result.status).send({ error: result.error });
      return reply.send({ success: true });
    },
  );

  /* ---------- POST /api/approvals/decision-files ---------- */
  fastify.post('/api/approvals/decision-files', adminOrUser, async (request, reply) => {
    const body = approvalDecisionFileBodySchema.parse(request.body);
    const data = await request.server.repos.approvals.addDecisionFile({
      approvalDecisionId: body.approvalDecisionId,
      fileName: body.fileName,
      fileKey: body.fileKey,
      fileSize: body.fileSize ?? null,
      mimeType: body.mimeType ?? null,
      createdBy: body.createdBy,
    });
    return reply.status(201).send({ data });
  });

  /* ---------- DELETE /api/approvals/decision-files/:id ---------- */
  fastify.delete('/api/approvals/decision-files/:id', adminOrUser, async (request) => {
    const { id } = request.params as { id: string };
    await request.server.repos.approvals.deleteDecisionFile(id);
    return { success: true };
  });

  /* ---------- GET /api/approvals/pending ---------- */
  fastify.get('/api/approvals/pending', adminOrUser, async (request) => {
    const user = request.user!;
    const query = request.query as { department: string; isAdmin?: string };
    return request.server.repos.approvals.listPendingByDepartment({
      userId: user.id,
      department: query.department,
      isAdmin: query.isAdmin === 'true' || user.role === 'admin',
    });
  });

  /* ---------- GET /api/approvals/pending-requests ---------- */
  fastify.get('/api/approvals/pending-requests', adminOrUser, async (request) => {
    const user = request.user!;
    const query = request.query as { department: string; userId?: string; isAdmin?: string };
    return request.server.repos.approvals.listPendingByDepartment({
      userId: user.id,
      department: query.department,
      isAdmin: query.isAdmin === 'true' || user.role === 'admin',
    });
  });

  /* ---------- GET /api/approvals/rp-pending-requests ---------- */
  fastify.get('/api/approvals/rp-pending-requests', adminOrUser, async (request) => {
    const user = request.user!;
    return request.server.repos.approvals.listRpPending({
      userId: user.id,
      isAdmin: user.role === 'admin',
    });
  });

  /* ---------- GET /api/approvals/approved ---------- */
  fastify.get('/api/approvals/approved', adminOrUser, async (request) => {
    const user = request.user!;
    return request.server.repos.approvals.listApproved({ userId: user.id });
  });

  /* ---------- GET /api/approvals/approved-count ---------- */
  fastify.get('/api/approvals/approved-count', adminOrUser, async (request) => {
    const user = request.user!;
    const query = request.query as { allSites?: string; siteIds?: string; showDeleted?: string };
    const count = await request.server.repos.approvals.countApproved({
      allSites: query.allSites === 'true' || user.role === 'admin',
      siteIds: query.siteIds ? query.siteIds.split(',') : [],
      showDeleted: user.role === 'admin' && query.showDeleted === 'true',
    });
    return { count };
  });

  /* ---------- GET /api/approvals/rejected ---------- */
  fastify.get('/api/approvals/rejected', adminOrUser, async (request) => {
    const user = request.user!;
    return request.server.repos.approvals.listRejected({ userId: user.id });
  });

  /* ---------- GET /api/approvals/rejected-count ---------- */
  fastify.get('/api/approvals/rejected-count', adminOrUser, async (request) => {
    const user = request.user!;
    const query = request.query as { allSites?: string; siteIds?: string; showDeleted?: string };
    const count = await request.server.repos.approvals.countRejected({
      allSites: query.allSites === 'true' || user.role === 'admin',
      siteIds: query.siteIds ? query.siteIds.split(',') : [],
      showDeleted: user.role === 'admin' && query.showDeleted === 'true',
    });
    return { count };
  });
}

export default approvalRoutes;
