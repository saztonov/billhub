import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  createContractRequestBodySchema,
  updateContractRequestBodySchema,
  contractDetailsBodySchema,
  sendToRevisionBodySchema,
  contractCompleteRevisionBodySchema,
  contractCommentReasonBodySchema,
  addContractFileBodySchema,
  contractFileRejectionBodySchema,
  contractToggleFileRejectionBodySchema,
  contractSignedContractBodySchema,
} from '../schemas/contract-request.js';
import type { ContractRequestListFilter } from '../repositories/contract-request.repository.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов заявок на договор (через fastify.repos)          */
/* ------------------------------------------------------------------ */

async function contractRequestRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticate] };
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /* ---------- GET /api/contract-requests ---------- */
  fastify.get('/api/contract-requests', auth, async (request, reply) => {
    const user = request.user!;
    const query = request.query as Record<string, string | undefined>;
    const repo = request.server.repos.contractRequests;

    const filter: ContractRequestListFilter = {
      showDeleted: user.role === 'admin' && query.showDeleted === 'true',
      supplierId: query.supplierId,
      siteId: query.siteId,
      statusId: query.statusId,
    };
    if (user.role === 'counterparty_user' && user.counterpartyId) {
      filter.counterpartyId = user.counterpartyId;
    } else if (query.counterpartyId) {
      filter.counterpartyId = query.counterpartyId;
    }
    if (user.role === 'user' && !user.allSites) {
      const siteIds = await repo.getUserSiteIds(user.id);
      if (siteIds.length === 0) return reply.send([]);
      filter.siteIds = siteIds;
    }

    // Серверная пагинация — только если клиент явно запросил (как в /api/payment-requests).
    // Иначе отдаём полный список, а таблица листает его на клиенте.
    if (query.page || query.pageSize) {
      filter.pagination = {
        page: parseInt(query.page ?? '1', 10),
        pageSize: parseInt(query.pageSize ?? '50', 10),
      };
    }

    return reply.send(await repo.list(filter));
  });

  /* ---------- GET /api/contract-requests/status-counts ---------- */
  fastify.get('/api/contract-requests/status-counts', auth, async (request, reply) => {
    const user = request.user!;
    const query = request.query as Record<string, string | undefined>;
    const repo = request.server.repos.contractRequests;

    const filter: { counterpartyId?: string; siteIds?: string[] } = {};
    if (user.role === 'counterparty_user' && user.counterpartyId) {
      filter.counterpartyId = user.counterpartyId;
    } else if (query.counterpartyId) {
      filter.counterpartyId = query.counterpartyId;
    }
    if (user.role === 'user' && !user.allSites) {
      filter.siteIds = await repo.getUserSiteIds(user.id);
    }
    return reply.send(await repo.statusCounts(filter));
  });

  /* ---------- GET /api/contract-requests/:id ---------- */
  fastify.get('/api/contract-requests/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const repo = request.server.repos.contractRequests;

    const cr = await repo.getById(id);
    if (!cr) return reply.status(404).send({ error: 'Заявка не найдена' });
    if (user.role === 'counterparty_user' && user.counterpartyId) {
      const ownerId = await repo.getOwnerCounterpartyId(id);
      if (ownerId !== user.counterpartyId) {
        return reply.status(403).send({ error: 'Доступ запрещён' });
      }
    }
    return reply.send(cr);
  });

  /* ---------- POST /api/contract-requests ---------- */
  fastify.post('/api/contract-requests', auth, async (request, reply) => {
    const user = request.user!;
    const body = createContractRequestBodySchema.parse(request.body);

    if (await request.server.repos.suppliers.isSbRejected(body.supplierId)) {
      return reply
        .status(403)
        .send({ error: 'Поставщик отклонён службой безопасности — создание заявки невозможно' });
    }

    const result = await request.server.repos.contractRequests.create({
      siteId: body.siteId,
      counterpartyId: body.counterpartyId,
      supplierId: body.supplierId,
      partiesCount: body.partiesCount,
      subjectType: body.subjectType,
      subjectDetail: body.subjectDetail,
      createdBy: user.id,
    });
    return reply
      .status(201)
      .send({ requestId: result.requestId, requestNumber: result.requestNumber });
  });

  /* ---------- PUT /api/contract-requests/:id ---------- */
  fastify.put('/api/contract-requests/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const repo = request.server.repos.contractRequests;

    const gate = await repo.getStatusGate(id);
    if (!gate) return reply.status(404).send({ error: 'Заявка не найдена' });

    const isCounterpartyUser = user.role === 'counterparty_user';
    if (isCounterpartyUser) {
      if (gate.counterpartyId !== user.counterpartyId) {
        return reply.status(403).send({ error: 'Нет доступа к заявке' });
      }
      if (gate.statusCode === 'approved_waiting' || gate.statusCode === 'concluded') {
        return reply.status(403).send({ error: 'Редактирование запрещено в текущем статусе' });
      }
    } else if (user.role !== 'admin' && user.role !== 'user') {
      return reply.status(403).send({ error: 'Нет прав на редактирование' });
    }

    const patch = updateContractRequestBodySchema.parse(request.body);
    await repo.update(id, patch, { stripCounterparty: isCounterpartyUser });
    return reply.send({ success: true });
  });

  /* ---------- DELETE /api/contract-requests/:id ---------- */
  fastify.delete('/api/contract-requests/:id', auth, async (request) => {
    const { id } = request.params as { id: string };
    await request.server.repos.contractRequests.softDelete(id);
    return { success: true };
  });

  /* ---------- POST /api/contract-requests/:id/files ---------- */
  fastify.post('/api/contract-requests/:id/files', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = addContractFileBodySchema.parse(request.body);
    await request.server.repos.contractRequests.addFile(id, body);
    return reply.status(201).send({ success: true });
  });

  /* ---------- PATCH /api/contract-requests/files/:fileId/rejection ---------- */
  fastify.patch('/api/contract-requests/files/:fileId/rejection', adminOrUser, async (request) => {
    const { fileId } = request.params as { fileId: string };
    const body = contractFileRejectionBodySchema.parse(request.body);
    await request.server.repos.contractRequests.setFileRejection(
      fileId,
      body.isRejected,
      body.isRejected ? body.userId : null,
    );
    return { success: true, isRejected: body.isRejected };
  });

  /* ---------- POST /:id/revision  и  /:id/send-to-revision (алиасы) ---------- */
  const sendToRevisionHandler = async (request: import('fastify').FastifyRequest) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = sendToRevisionBodySchema.parse(request.body);
    await request.server.repos.contractRequests.sendToRevision(id, body.targets, user.id);
    return { success: true };
  };
  fastify.post('/api/contract-requests/:id/revision', adminOrUser, sendToRevisionHandler);
  fastify.post('/api/contract-requests/:id/send-to-revision', adminOrUser, sendToRevisionHandler);

  /* ---------- POST /:id/revision-complete  и  /:id/complete-revision (алиасы) ---------- */
  const completeRevisionHandler = async (request: import('fastify').FastifyRequest) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = contractCompleteRevisionBodySchema.parse(request.body);
    await request.server.repos.contractRequests.completeRevision(id, body.target, user.id);
    return { success: true };
  };
  fastify.post('/api/contract-requests/:id/revision-complete', auth, completeRevisionHandler);
  fastify.post('/api/contract-requests/:id/complete-revision', auth, completeRevisionHandler);

  /* ---------- POST /:id/original-received  и  /:id/mark-original-received (алиасы) ---------- */
  const markOriginalReceivedHandler = async (request: import('fastify').FastifyRequest) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    await request.server.repos.contractRequests.markOriginalReceived(id, user.id);
    return { success: true };
  };
  fastify.post(
    '/api/contract-requests/:id/original-received',
    adminOrUser,
    markOriginalReceivedHandler,
  );
  fastify.post(
    '/api/contract-requests/:id/mark-original-received',
    adminOrUser,
    markOriginalReceivedHandler,
  );

  /* ---------- POST /api/contract-requests/:id/approve ---------- */
  fastify.post('/api/contract-requests/:id/approve', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const repo = request.server.repos.contractRequests;

    const supplierId = await repo.getSupplierId(id);
    if (await request.server.repos.suppliers.isSbRejected(supplierId)) {
      return reply
        .status(403)
        .send({ error: 'Поставщик отклонён службой безопасности — согласование невозможно' });
    }
    await repo.approve(id, user.id);
    return reply.send({ success: true });
  });

  /* ---------- POST /api/contract-requests/:id/revert-to-previous ---------- */
  fastify.post(
    '/api/contract-requests/:id/revert-to-previous',
    adminOrUser,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.user!;
      if (user.role !== 'admin' && user.department !== 'omts') {
        return reply.status(403).send({ error: 'Недостаточно прав' });
      }
      const body = contractCommentReasonBodySchema.parse(request.body ?? {});
      await request.server.repos.contractRequests.revertToPrevious(id, user.id, body.comment);
      return reply.send({ success: true });
    },
  );

  /* ---------- POST /api/contract-requests/:id/reject ---------- */
  fastify.post('/api/contract-requests/:id/reject', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    if (user.role !== 'admin' && user.department !== 'omts') {
      return reply.status(403).send({ error: 'Недостаточно прав' });
    }
    const body = contractCommentReasonBodySchema.parse(request.body ?? {});
    const comment = body.comment?.trim();
    if (!comment) return reply.status(400).send({ error: 'Укажите причину отклонения' });
    await request.server.repos.contractRequests.reject(id, user.id, comment);
    return reply.send({ success: true });
  });

  /* ---------- GET /api/contract-requests/:id/files ---------- */
  fastify.get('/api/contract-requests/:id/files', auth, async (request) => {
    const { id } = request.params as { id: string };
    return request.server.repos.contractRequests.listFiles(id);
  });

  /* ---------- POST /api/contract-requests/:id/assign ---------- */
  fastify.post('/api/contract-requests/:id/assign', adminOrUser, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    await request.server.repos.contractRequests.assign(id, user.id);
    return { success: true };
  });

  /* ---------- PATCH /api/contract-requests/:id/contract-details ---------- */
  fastify.patch('/api/contract-requests/:id/contract-details', adminOrUser, async (request) => {
    const { id } = request.params as { id: string };
    const body = contractDetailsBodySchema.parse(request.body);
    await request.server.repos.contractRequests.setContractDetails(id, body);
    return { success: true };
  });

  /* ---------- POST /api/contract-requests/:id/toggle-file-rejection ---------- */
  fastify.post(
    '/api/contract-requests/:id/toggle-file-rejection',
    adminOrUser,
    async (request, reply) => {
      const user = request.user!;
      const body = contractToggleFileRejectionBodySchema.parse(request.body);
      const repo = request.server.repos.contractRequests;

      const current = await repo.getFileRejection(body.fileId);
      if (current === null) return reply.status(404).send({ error: 'Файл не найден' });
      const newRejected = !current;
      await repo.setFileRejection(body.fileId, newRejected, newRejected ? user.id : null);
      return reply.send({ success: true, isRejected: newRejected });
    },
  );

  /* ---------- PATCH /api/contract-requests/files/:fileId/signed-contract ---------- */
  fastify.patch(
    '/api/contract-requests/files/:fileId/signed-contract',
    adminOrUser,
    async (request) => {
      const { fileId } = request.params as { fileId: string };
      const body = contractSignedContractBodySchema.parse(request.body);
      await request.server.repos.contractRequests.setSignedContract(
        fileId,
        !!body.isSignedContract,
      );
      return { success: true, isSignedContract: !!body.isSignedContract };
    },
  );
}

export default contractRequestRoutes;
