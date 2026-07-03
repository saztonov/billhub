import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  createPaymentRequestBodySchema,
  updatePaymentRequestBodySchema,
  withdrawBodySchema,
  resubmitBodySchema,
  dpDataBodySchema,
  toggleFileRejectionBodySchema,
} from '../schemas/payment-request.js';
import type { PaymentRequestListFilter } from '../repositories/payment-request.repository.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов заявок на оплату (через fastify.repos)            */
/* ------------------------------------------------------------------ */

async function paymentRequestRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticate] };
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /* ---------- GET /api/payment-requests ---------- */
  fastify.get('/api/payment-requests', auth, async (request, reply) => {
    const user = request.user!;
    const query = request.query as Record<string, string | undefined>;
    const repo = request.server.repos.paymentRequests;

    const filter: PaymentRequestListFilter = {
      showDeleted: user.role === 'admin' && query.showDeleted === 'true',
      supplierId: query.supplierId,
      siteId: query.siteId,
      statusId: query.statusId,
      costTypeId: query.costTypeId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      search: query.search,
    };

    // Изоляция контрагента
    if (user.role === 'counterparty_user' && user.counterpartyId) {
      filter.counterpartyId = user.counterpartyId;
    } else if (query.counterpartyId) {
      filter.counterpartyId = query.counterpartyId;
    }

    // Фильтрация по объектам для user без all_sites
    if (user.role === 'user' && !user.allSites) {
      const siteIds = await repo.getUserSiteIds(user.id);
      if (siteIds.length === 0) return reply.send([]);
      filter.siteIds = siteIds;
    }

    if (query.page || query.pageSize) {
      filter.pagination = {
        page: parseInt(query.page ?? '1', 10),
        pageSize: parseInt(query.pageSize ?? '50', 10),
      };
    }

    return reply.send(await repo.list(filter));
  });

  /* ---------- GET /api/payment-requests/:id ---------- */
  fastify.get('/api/payment-requests/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const repo = request.server.repos.paymentRequests;

    const pr = await repo.getById(id);
    if (!pr) return reply.status(404).send({ error: 'Заявка не найдена' });

    if (user.role === 'counterparty_user' && user.counterpartyId) {
      const ownerId = await repo.getOwnerCounterpartyId(id);
      if (ownerId !== user.counterpartyId) {
        return reply.status(403).send({ error: 'Доступ запрещён' });
      }
    }

    return reply.send(pr);
  });

  /* ---------- POST /api/payment-requests ---------- */
  fastify.post('/api/payment-requests', auth, async (request, reply) => {
    const user = request.user!;
    const body = createPaymentRequestBodySchema.parse(request.body);

    const counterpartyId =
      user.role === 'counterparty_user' ? user.counterpartyId! : body.counterpartyId;
    if (!counterpartyId) {
      return reply.status(400).send({ error: 'counterpartyId обязателен' });
    }

    if (await request.server.repos.suppliers.isSbRejected(body.supplierId)) {
      return reply
        .status(403)
        .send({ error: 'Поставщик отклонён службой безопасности — создание заявки невозможно' });
    }

    const result = await request.server.repos.paymentRequests.create({
      counterpartyId,
      siteId: body.siteId,
      deliveryDays: body.deliveryDays,
      deliveryDaysType: body.deliveryDaysType,
      shippingConditionId: body.shippingConditionId,
      comment: body.comment,
      totalFiles: body.totalFiles,
      invoiceAmount: body.invoiceAmount,
      supplierId: body.supplierId,
      createdBy: user.id,
    });

    return reply
      .status(201)
      .send({ requestId: result.requestId, requestNumber: result.requestNumber });
  });

  /* ---------- PUT /api/payment-requests/:id ---------- */
  fastify.put('/api/payment-requests/:id', auth, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = updatePaymentRequestBodySchema.parse(request.body);

    await request.server.repos.paymentRequests.update(id, body, {
      userId: user.id,
      actingCounterpartyId: user.role === 'counterparty_user' ? user.counterpartyId : undefined,
    });
    return { success: true };
  });

  /* ---------- DELETE /api/payment-requests/:id ---------- */
  fastify.delete('/api/payment-requests/:id', auth, async (request) => {
    const { id } = request.params as { id: string };
    await request.server.repos.paymentRequests.softDelete(id);
    return { success: true };
  });

  /* ---------- POST /api/payment-requests/:id/withdraw ---------- */
  fastify.post('/api/payment-requests/:id/withdraw', auth, async (request) => {
    const { id } = request.params as { id: string };
    const body = withdrawBodySchema.parse(request.body ?? {});
    await request.server.repos.paymentRequests.withdraw(id, body.comment);
    return { success: true };
  });

  /* ---------- POST /api/payment-requests/:id/resubmit ---------- */
  fastify.post('/api/payment-requests/:id/resubmit', auth, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = resubmitBodySchema.parse(request.body);
    await request.server.repos.paymentRequests.resubmit(id, body, user.id);
    return { success: true };
  });

  /* ---------- GET /api/payment-requests/:id/files ---------- */
  fastify.get('/api/payment-requests/:id/files', auth, async (request) => {
    const { id } = request.params as { id: string };
    return request.server.repos.paymentRequests.listFiles(id);
  });

  /* ---------- POST /api/payment-requests/:id/toggle-file-rejection ---------- */
  fastify.post(
    '/api/payment-requests/:id/toggle-file-rejection',
    adminOrUser,
    async (request, reply) => {
      const user = request.user!;
      const body = toggleFileRejectionBodySchema.parse(request.body);

      const current = await request.server.repos.paymentRequests.getFileRejection(body.fileId);
      if (current === null) return reply.status(404).send({ error: 'Файл не найден' });

      const newRejected = !current;
      await request.server.repos.paymentRequests.setFileRejection(
        body.fileId,
        newRejected,
        newRejected ? user.id : null,
      );
      return reply.send({ success: true, isRejected: newRejected });
    },
  );

  /* ---------- PUT /api/payment-requests/:id/dp-data ---------- */
  fastify.put('/api/payment-requests/:id/dp-data', adminOrUser, async (request) => {
    const { id } = request.params as { id: string };
    const body = dpDataBodySchema.parse(request.body);
    await request.server.repos.paymentRequests.setDpData(id, body);
    return { success: true };
  });
}

export default paymentRequestRoutes;
