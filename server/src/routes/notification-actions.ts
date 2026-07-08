import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import {
  paymentStatusChangedBodySchema,
  paymentRevisionBodySchema,
  paymentNewPendingBodySchema,
  paymentResubmittedBodySchema,
  paymentAssignedBodySchema,
  paymentNewCommentBodySchema,
  paymentNewFileBodySchema,
  checkSpecialistsBodySchema,
  contractNewRequestBodySchema,
  contractStatusChangedBodySchema,
  contractRevisionBodySchema,
  contractNewCommentBodySchema,
  contractNewFileBodySchema,
} from '../schemas/notification-action.js';

/* ------------------------------------------------------------------ */
/*  Маршруты уведомлений — действия (через fastify.repos)             */
/* ------------------------------------------------------------------ */

async function notificationActionRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticate] };
  const ok = { success: true };

  /* ================ Заявки на оплату ================ */

  fastify.post('/api/notifications/payment-request/status-changed', auth, async (request) => {
    await request.server.repos.notificationActions.paymentStatusChanged(
      paymentStatusChangedBodySchema.parse(request.body),
    );
    return ok;
  });

  fastify.post('/api/notifications/payment-request/revision', auth, async (request) => {
    await request.server.repos.notificationActions.paymentRevision(
      paymentRevisionBodySchema.parse(request.body),
    );
    return ok;
  });

  fastify.post('/api/notifications/payment-request/new-pending', auth, async (request) => {
    await request.server.repos.notificationActions.paymentNewPending(
      paymentNewPendingBodySchema.parse(request.body),
    );
    return ok;
  });

  fastify.post('/api/notifications/payment-request/resubmitted', auth, async (request) => {
    await request.server.repos.notificationActions.paymentResubmitted(
      paymentResubmittedBodySchema.parse(request.body),
    );
    return ok;
  });

  // Роут omts-rp-pending удалён: уведомление назначенцу о входе заявки на этап «РП»
  // создаётся на сервере в approve() (approval.drizzle.ts), фронтовый вызов был мёртвым кодом.

  fastify.post('/api/notifications/payment-request/assigned', auth, async (request) => {
    await request.server.repos.notificationActions.paymentAssigned(
      paymentAssignedBodySchema.parse(request.body),
    );
    return ok;
  });

  fastify.post('/api/notifications/payment-request/new-comment', auth, async (request) => {
    await request.server.repos.notificationActions.paymentNewComment(
      paymentNewCommentBodySchema.parse(request.body),
    );
    return ok;
  });

  fastify.post('/api/notifications/payment-request/new-file', auth, async (request) => {
    await request.server.repos.notificationActions.paymentNewFile(
      paymentNewFileBodySchema.parse(request.body),
    );
    return ok;
  });

  fastify.post('/api/notifications/payment-request/check-specialists', auth, async (request) => {
    await request.server.repos.notificationActions.checkSpecialists(
      checkSpecialistsBodySchema.parse(request.body),
    );
    return ok;
  });

  /* ================ Заявки на договор ================ */

  fastify.post('/api/notifications/contract-request/new-request', auth, async (request) => {
    await request.server.repos.notificationActions.contractNewRequest(
      contractNewRequestBodySchema.parse(request.body),
    );
    return ok;
  });

  fastify.post('/api/notifications/contract-request/status-changed', auth, async (request) => {
    await request.server.repos.notificationActions.contractStatusChanged(
      contractStatusChangedBodySchema.parse(request.body),
    );
    return ok;
  });

  fastify.post('/api/notifications/contract-request/revision', auth, async (request) => {
    await request.server.repos.notificationActions.contractRevision(
      contractRevisionBodySchema.parse(request.body),
    );
    return ok;
  });

  fastify.post('/api/notifications/contract-request/new-comment', auth, async (request) => {
    await request.server.repos.notificationActions.contractNewComment(
      contractNewCommentBodySchema.parse(request.body),
    );
    return ok;
  });

  fastify.post('/api/notifications/contract-request/new-file', auth, async (request) => {
    await request.server.repos.notificationActions.contractNewFile(
      contractNewFileBodySchema.parse(request.body),
    );
    return ok;
  });
}

export default notificationActionRoutes;
