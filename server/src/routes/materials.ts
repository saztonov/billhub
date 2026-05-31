import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { updateEstimateBodySchema } from '../schemas/material.js';
import type { MaterialFilter } from '../repositories/material.repository.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов материалов (через fastify.repos.materials)        */
/* ------------------------------------------------------------------ */

function parseFilter(query: Record<string, string | undefined>): MaterialFilter {
  return {
    counterpartyId: query.counterpartyId,
    supplierId: query.supplierId,
    siteId: query.siteId,
    costTypeId: query.costTypeId,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
  };
}

async function materialRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /* ---------- GET /api/materials/request-info/:paymentRequestId ---------- */
  fastify.get(
    '/api/materials/request-info/:paymentRequestId',
    adminOrUser,
    async (request, reply) => {
      const { paymentRequestId } = request.params as { paymentRequestId: string };
      const info = await request.server.repos.materials.getRequestInfo(paymentRequestId);
      if (!info) return reply.status(404).send({ error: 'Заявка не найдена' });
      return reply.send(info);
    },
  );

  /* ---------- GET /api/materials/dictionary ---------- */
  fastify.get('/api/materials/dictionary', adminOrUser, async (request) => {
    return request.server.repos.materials.listDictionary();
  });

  /* ---------- GET /api/materials/requests ---------- */
  fastify.get('/api/materials/requests', adminOrUser, async (request) => {
    return request.server.repos.materials.listRequests();
  });

  /* ---------- GET /api/materials/recognized/:paymentRequestId ---------- */
  fastify.get('/api/materials/recognized/:paymentRequestId', adminOrUser, async (request) => {
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    return request.server.repos.materials.listRecognized(paymentRequestId);
  });

  /* ---------- PUT /api/materials/recognized/:id ---------- */
  fastify.put('/api/materials/recognized/:id', adminOrUser, async (request) => {
    const { id } = request.params as { id: string };
    const body = updateEstimateBodySchema.parse(request.body);
    await request.server.repos.materials.updateEstimate(id, body.estimateQuantity);
    return { success: true };
  });

  /* ---------- PATCH /api/materials/recognized/:id/estimate (алиас) ---------- */
  fastify.patch('/api/materials/recognized/:id/estimate', adminOrUser, async (request) => {
    const { id } = request.params as { id: string };
    const body = updateEstimateBodySchema.parse(request.body);
    await request.server.repos.materials.updateEstimate(id, body.estimateQuantity);
    return { success: true };
  });

  /* ---------- GET /api/materials/summary ---------- */
  fastify.get('/api/materials/summary', adminOrUser, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return request.server.repos.materials.getSummary(parseFilter(query));
  });

  /* ---------- GET /api/materials/hierarchical-summary ---------- */
  fastify.get('/api/materials/hierarchical-summary', adminOrUser, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return request.server.repos.materials.getHierarchicalSummary(parseFilter(query));
  });

  /* ---------- GET /api/materials/invoice-files/:paymentRequestId ---------- */
  fastify.get('/api/materials/invoice-files/:paymentRequestId', adminOrUser, async (request) => {
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    return request.server.repos.materials.listInvoiceFiles(paymentRequestId);
  });
}

export default materialRoutes;
