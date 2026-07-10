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
import {
  getGeneralContractorSetting,
  GENERAL_CONTRACTOR_INN,
} from '../services/references/general-contractor-setting.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов заявок на оплату (через fastify.repos)            */
/* ------------------------------------------------------------------ */

async function paymentRequestRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticate] };
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };
  // Повторная отправка — только владелец-контрагент своей заявки либо admin (проверка владельца в репозитории).
  const ownerOrAdmin = { preHandler: [authenticate, requireRole('admin', 'counterparty_user')] };

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

    // rpLinked — заявка входит в РП: фронт скрывает ручную правку поля «РП» (0010).
    const rpLinked = await repo.isInRpLetter(id);
    return reply.send({ ...pr, rpLinked });
  });

  /* ---------- POST /api/payment-requests ---------- */
  fastify.post('/api/payment-requests', auth, async (request, reply) => {
    const user = request.user!;
    const body = createPaymentRequestBodySchema.parse(request.body);

    // Подрядчик создаёт только обычные заявки; типы «работа»/«своя закупка» — только admin/user.
    const requestType = user.role === 'counterparty_user' ? 'contractor' : body.requestType;

    // Поля, скрытые для типа, обнуляем на сервере (не доверяем клиенту):
    //   contractor_work — без поставщика, срока, условий отгрузки;
    //   own_purchase    — без срока (условия отгрузки и поставщик остаются).
    const supplierId = requestType === 'contractor_work' ? null : (body.supplierId ?? null);
    const deliveryDays = requestType === 'contractor' ? (body.deliveryDays ?? null) : null;
    const shippingConditionId =
      requestType === 'contractor_work' ? null : (body.shippingConditionId ?? null);

    // Контрагент: own_purchase — всегда генподрядчик (СУ-10) из настройки; клиентское значение игнорируем.
    let counterpartyId: string | null;
    if (requestType === 'own_purchase') {
      const db = request.server.db;
      if (!db) return reply.status(500).send({ error: 'Своя закупка требует DB_PROVIDER=drizzle' });
      const gc = await getGeneralContractorSetting(db);
      if (!gc || gc.inn !== GENERAL_CONTRACTOR_INN) {
        return reply
          .status(400)
          .send({ error: 'Генподрядчик (СУ-10) не настроен — обратитесь к администратору' });
      }
      counterpartyId = gc.counterpartyId;
    } else {
      counterpartyId =
        user.role === 'counterparty_user' ? user.counterpartyId! : (body.counterpartyId ?? null);
    }
    if (!counterpartyId) {
      return reply.status(400).send({ error: 'counterpartyId обязателен' });
    }

    if (supplierId && (await request.server.repos.suppliers.isSbRejected(supplierId))) {
      return reply
        .status(403)
        .send({ error: 'Поставщик отклонён службой безопасности — создание заявки невозможно' });
    }

    const result = await request.server.repos.paymentRequests.create({
      requestType,
      counterpartyId,
      siteId: body.siteId,
      deliveryDays,
      deliveryDaysType: body.deliveryDaysType ?? 'working',
      shippingConditionId,
      comment: body.comment,
      totalFiles: body.totalFiles,
      invoiceAmount: body.invoiceAmount,
      supplierId,
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
  fastify.post('/api/payment-requests/:id/resubmit', ownerOrAdmin, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = resubmitBodySchema.parse(request.body);
    await request.server.repos.paymentRequests.resubmit(id, body, user.id, {
      counterpartyId: user.counterpartyId ?? null,
      isAdmin: user.role === 'admin',
    });
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
  fastify.put('/api/payment-requests/:id/dp-data', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = dpDataBodySchema.parse(request.body);
    const repo = request.server.repos.paymentRequests;
    // Заявка в РП — поле «РП» заполняется автоматически, ручная правка запрещена (0010).
    if (await repo.isInRpLetter(id)) {
      return reply.status(400).send({
        error: 'Поле «РП» этой заявки заполняется автоматически из РП — ручная правка недоступна',
      });
    }
    await repo.setDpData(id, body);
    return { success: true };
  });
}

export default paymentRequestRoutes;
