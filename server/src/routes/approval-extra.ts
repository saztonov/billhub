import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  approvalDecideBodySchema,
  approvalRevisionBodySchema,
  approvalFieldUpdatesSchema,
  approvalDecisionFileByPathBodySchema,
} from '../schemas/approval.js';

/* ------------------------------------------------------------------ */
/*  Дополнительные маршруты согласований (через fastify.repos.approvals) */
/* ------------------------------------------------------------------ */

async function approvalExtraRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /* ---------- POST /api/approvals/payment-request/:paymentRequestId/stage-history ---------- */
  fastify.post(
    '/api/approvals/payment-request/:paymentRequestId/stage-history',
    adminOrUser,
    async (request, reply) => {
      const { paymentRequestId } = request.params as { paymentRequestId: string };
      const entry = request.body as Record<string, unknown>;
      await request.server.repos.approvals.appendStageHistory(paymentRequestId, entry);
      return reply.send({ success: true });
    },
  );

  /* ---------- POST /api/approvals/payment-request/:paymentRequestId/revision ---------- */
  fastify.post(
    '/api/approvals/payment-request/:paymentRequestId/revision',
    adminOrUser,
    async (request, reply) => {
      const user = request.user!;
      const { paymentRequestId } = request.params as { paymentRequestId: string };
      const body = approvalRevisionBodySchema.parse(request.body);
      const result = await request.server.repos.approvals.sendToRevision(
        paymentRequestId,
        user.id,
        body.comment ?? '',
      );
      if (!result.ok) return reply.status(result.status).send({ error: result.error });
      return reply.send({ success: true });
    },
  );

  /* ---------- POST /api/approvals/payment-request/:paymentRequestId/revision-complete ---------- */
  fastify.post(
    '/api/approvals/payment-request/:paymentRequestId/revision-complete',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const { paymentRequestId } = request.params as { paymentRequestId: string };
      const fieldUpdates = approvalFieldUpdatesSchema.parse(request.body);
      const result = await request.server.repos.approvals.completeRevision(
        paymentRequestId,
        user.id,
        fieldUpdates,
      );
      if (!result.ok) return reply.status(result.status).send({ error: result.error });
      return reply.send({ success: true });
    },
  );

  /* ---------- POST /api/approvals/create-decision ---------- */
  fastify.post('/api/approvals/create-decision', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const body = approvalDecideBodySchema.parse(request.body);
    const result = await request.server.repos.approvals.createDecisionOnly({
      paymentRequestId: body.paymentRequestId,
      department: body.department,
      action: body.action,
      comment: body.comment,
      userId: user.id,
      userDepartment: user.department ?? null,
      isAdmin: user.role === 'admin',
    });
    if (!result.ok) return reply.status(result.status).send({ error: result.error });
    return reply.send({ success: true, decisionId: result.decisionId });
  });

  /* ---------- POST /api/approvals/decisions/:decisionId/files ---------- */
  fastify.post(
    '/api/approvals/decisions/:decisionId/files',
    adminOrUser,
    async (request, reply) => {
      const { decisionId } = request.params as { decisionId: string };
      const body = approvalDecisionFileByPathBodySchema.parse(request.body);
      const data = await request.server.repos.approvals.addDecisionFile({
        approvalDecisionId: decisionId,
        fileName: body.fileName,
        fileKey: body.fileKey,
        fileSize: body.fileSize ?? null,
        mimeType: body.mimeType ?? null,
        createdBy: body.userId,
      });
      return reply.status(201).send({ data });
    },
  );

  /* ---------- GET /api/approvals/approved-requests ---------- */
  fastify.get('/api/approvals/approved-requests', adminOrUser, async (request) => {
    const user = request.user!;
    const query = request.query as { allSites?: string; siteIds?: string; showDeleted?: string };
    return request.server.repos.approvals.listApprovedArray({
      allSites: query.allSites === 'true' || user.role === 'admin',
      siteIds: query.siteIds ? query.siteIds.split(',') : [],
      showDeleted: user.role === 'admin' && query.showDeleted === 'true',
    });
  });

  /* ---------- GET /api/approvals/rejected-requests ---------- */
  fastify.get('/api/approvals/rejected-requests', adminOrUser, async (request) => {
    const user = request.user!;
    const query = request.query as { allSites?: string; siteIds?: string; showDeleted?: string };
    return request.server.repos.approvals.listRejectedArray({
      allSites: query.allSites === 'true' || user.role === 'admin',
      siteIds: query.siteIds ? query.siteIds.split(',') : [],
      showDeleted: user.role === 'admin' && query.showDeleted === 'true',
    });
  });

  /* ---------- GET /api/approvals/pending-count ---------- */
  fastify.get('/api/approvals/pending-count', adminOrUser, async (request) => {
    const user = request.user!;
    const query = request.query as { department?: string; userId?: string; isAdmin?: string };
    if (!query.department) return { count: 0 };
    const count = await request.server.repos.approvals.countPendingByDepartment({
      userId: user.id,
      department: query.department,
      isAdmin: query.isAdmin === 'true' || user.role === 'admin',
    });
    return { count };
  });

  /* ---------- GET /api/approvals/all-count ---------- */
  fastify.get('/api/approvals/all-count', adminOrUser, async (request) => {
    const user = request.user!;
    const query = request.query as { allSites?: string; siteIds?: string };
    const count = await request.server.repos.approvals.countAll({
      allSites: query.allSites === 'true' || user.role === 'admin',
      siteIds: query.siteIds ? query.siteIds.split(',') : [],
    });
    return { count };
  });

  /* ---------- GET /api/approvals/specialists-count ---------- */
  fastify.get('/api/approvals/specialists-count', adminOrUser, async (request) => {
    const user = request.user!;
    const count = await request.server.repos.approvals.countUnassignedSpecialists({
      userId: user.id,
    });
    return { count };
  });

  /* ---------- GET /api/approvals/rp-pending-count ---------- */
  fastify.get('/api/approvals/rp-pending-count', adminOrUser, async (request) => {
    const user = request.user!;
    const count = await request.server.repos.approvals.countRpPending({
      userId: user.id,
      isAdmin: user.role === 'admin',
    });
    return { count };
  });

  /* ---------- GET /api/approvals/ready-for-closure-count ---------- */
  fastify.get('/api/approvals/ready-for-closure-count', adminOrUser, async (request) => {
    const user = request.user!;
    const count = await request.server.repos.approvals.countReadyForClosure({ userId: user.id });
    return { count };
  });
}

export default approvalExtraRoutes;
