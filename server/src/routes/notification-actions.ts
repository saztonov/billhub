import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import {
  insertNotifications,
  getUsersByDepartmentAndSite,
  getPaymentRequestCreator,
  getContractRequestCreator,
  getContractRequestInfo,
  getAdminUserIds,
  getOmtsRpUsers,
  resolveCommentRecipients,
  resolveFileRecipients,
  resolveContractCommentRecipients,
  resolveContractFileRecipients,
} from '../services/notification-helpers.js';

/* ------------------------------------------------------------------ */
/*  Типы тел запросов                                                   */
/* ------------------------------------------------------------------ */

interface StatusChangedBody {
  paymentRequestId: string;
  statusLabel: string;
  actorUserId: string;
}

interface NewPendingBody {
  paymentRequestId: string;
  siteId: string;
  actorUserId: string;
  requestNumber?: string;
}

interface OmtsRpPendingBody {
  paymentRequestId: string;
  actorUserId: string;
}

interface ResubmittedBody {
  paymentRequestId: string;
  actorUserId: string;
  rejectedStage: number | null;
}

interface AssignedBody {
  paymentRequestId: string;
  assignedUserId: string;
  actorUserId: string;
}

interface NewCommentBody {
  paymentRequestId: string;
  actorUserId: string;
  recipient?: string | null;
}

interface NewFileBody {
  paymentRequestId: string;
  actorUserId: string;
}

interface CheckSpecialistsBody {
  paymentRequestId: string;
  siteId: string;
  department: 'omts' | 'shtab' | 'smetny';
}

interface RevisionBody {
  paymentRequestId: string;
  actorUserId: string;
}

interface ContractNewRequestBody {
  contractRequestId: string;
  siteId: string;
  actorUserId: string;
  requestNumber?: string;
}

interface ContractStatusChangedBody {
  contractRequestId: string;
  statusLabel: string;
  actorUserId: string;
}

interface ContractRevisionBody {
  contractRequestId: string;
  targets: Array<'shtab' | 'counterparty'>;
  actorUserId: string;
}

interface ContractNewCommentBody {
  contractRequestId: string;
  actorUserId: string;
  recipient?: string | null;
}

interface ContractNewFileBody {
  contractRequestId: string;
  actorUserId: string;
}

/* ------------------------------------------------------------------ */
/*  Маршруты уведомлений — действия                                    */
/* ------------------------------------------------------------------ */

async function notificationActionRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticate] };

  /* ================ Заявки на оплату ================ */

  /** Смена статуса — уведомление создателю заявки */
  fastify.post<{ Body: StatusChangedBody }>(
    '/api/notifications/payment-request/status-changed',
    auth,
    async (request, reply) => {
      const { paymentRequestId, statusLabel, actorUserId } = request.body;
      const supabase = fastify.supabase;

      const creatorId = await getPaymentRequestCreator(supabase, paymentRequestId);
      if (!creatorId || creatorId === actorUserId) {
        return reply.send({ success: true });
      }

      await insertNotifications(supabase, [{
        user_id: creatorId,
        type: 'status_changed',
        title: 'Изменён статус заявки',
        message: `Статус заявки изменён на «${statusLabel}»`,
        payment_request_id: paymentRequestId,
      }]);

      return reply.send({ success: true });
    },
  );

  /** Отправка на доработку — уведомление создателю заявки (подрядчику) */
  fastify.post<{ Body: RevisionBody }>(
    '/api/notifications/payment-request/revision',
    auth,
    async (request, reply) => {
      const { paymentRequestId, actorUserId } = request.body;
      const supabase = fastify.supabase;

      const creatorId = await getPaymentRequestCreator(supabase, paymentRequestId);
      if (!creatorId || creatorId === actorUserId) {
        return reply.send({ success: true });
      }

      // Получаем номер заявки
      const { data: req } = await supabase
        .from('payment_requests')
        .select('request_number')
        .eq('id', paymentRequestId)
        .single();

      const label = req?.request_number ? ` N${req.request_number}` : '';

      await insertNotifications(supabase, [{
        user_id: creatorId,
        type: 'status_changed',
        title: 'Заявка отправлена на доработку',
        message: `Заявка${label} отправлена на доработку`,
        payment_request_id: paymentRequestId,
      }]);

      return reply.send({ success: true });
    },
  );

  /** Новая заявка на согласовании — уведомление штабу */
  fastify.post<{ Body: NewPendingBody }>(
    '/api/notifications/payment-request/new-pending',
    auth,
    async (request, reply) => {
      const { paymentRequestId, siteId, actorUserId, requestNumber } = request.body;
      const supabase = fastify.supabase;

      const userIds = await getUsersByDepartmentAndSite(
        supabase, 'shtab', siteId, actorUserId,
      );

      const label = requestNumber ? ` N${requestNumber}` : '';
      await insertNotifications(supabase, userIds.map((uid) => ({
        user_id: uid,
        type: 'new_pending',
        title: 'Новая заявка на согласовании',
        message: `Поступила заявка${label} на согласование`,
        payment_request_id: paymentRequestId,
        site_id: siteId,
        department_id: 'shtab' as const,
      })));

      return reply.send({ success: true });
    },
  );

  /** Повторная отправка заявки — уведомление штабу (и ОМТС при rejected_stage=2) */
  fastify.post<{ Body: ResubmittedBody }>(
    '/api/notifications/payment-request/resubmitted',
    auth,
    async (request, reply) => {
      const { paymentRequestId, actorUserId, rejectedStage } = request.body;
      const supabase = fastify.supabase;

      // Читаем site_id и request_number из заявки
      const { data: req } = await supabase
        .from('payment_requests')
        .select('site_id, request_number')
        .eq('id', paymentRequestId)
        .single();

      if (!req) return reply.send({ success: true });

      const siteId = req.site_id as string;
      const requestNumber = req.request_number as string | null;
      const label = requestNumber ? ` N${requestNumber}` : '';

      // Всегда уведомляем Штаб
      const shtabIds = await getUsersByDepartmentAndSite(supabase, 'shtab', siteId, actorUserId);
      const notifications = shtabIds.map((uid) => ({
        user_id: uid,
        type: 'resubmitted' as const,
        title: 'Повторная отправка заявки',
        message: `Заявка${label} отправлена повторно на согласование`,
        payment_request_id: paymentRequestId,
        site_id: siteId,
        department_id: 'shtab' as const,
      }));

      // Если отклонение было на этапе ОМТС — уведомляем и их
      if (rejectedStage === 2) {
        const omtsIds = await getUsersByDepartmentAndSite(supabase, 'omts', siteId, actorUserId);
        for (const uid of omtsIds) {
          notifications.push({
            user_id: uid,
            type: 'resubmitted' as const,
            title: 'Повторная отправка заявки',
            message: `Заявка${label} отправлена повторно на согласование`,
            payment_request_id: paymentRequestId,
            site_id: siteId,
            department_id: 'omts' as const,
          });
        }
      }

      await insertNotifications(supabase, notifications);
      return reply.send({ success: true });
    },
  );

  /** Заявка поступила на согласование ОМТС РП */
  fastify.post<{ Body: OmtsRpPendingBody }>(
    '/api/notifications/payment-request/omts-rp-pending',
    auth,
    async (request, reply) => {
      const { paymentRequestId, actorUserId } = request.body;
      const supabase = fastify.supabase;

      const userIds = await getOmtsRpUsers(supabase, paymentRequestId);
      const filtered = userIds.filter((id) => id !== actorUserId);

      await insertNotifications(supabase, filtered.map((uid) => ({
        user_id: uid,
        type: 'omts_rp_pending',
        title: 'Заявка на согласовании ОМТС',
        message: 'Заявка поступила на согласование ОМТС РП',
        payment_request_id: paymentRequestId,
      })));

      return reply.send({ success: true });
    },
  );

  /** Назначен ответственный ОМТС — уведомление назначенному */
  fastify.post<{ Body: AssignedBody }>(
    '/api/notifications/payment-request/assigned',
    auth,
    async (request, reply) => {
      const { paymentRequestId, assignedUserId, actorUserId } = request.body;
      const supabase = fastify.supabase;

      if (assignedUserId === actorUserId) {
        return reply.send({ success: true });
      }

      await insertNotifications(supabase, [{
        user_id: assignedUserId,
        type: 'assigned',
        title: 'Вы назначены ответственным',
        message: 'Вам назначена заявка на обработку',
        payment_request_id: paymentRequestId,
      }]);

      return reply.send({ success: true });
    },
  );

  /** Новый комментарий — уведомление по текущему этапу заявки */
  fastify.post<{ Body: NewCommentBody }>(
    '/api/notifications/payment-request/new-comment',
    auth,
    async (request, reply) => {
      const { paymentRequestId, actorUserId, recipient } = request.body;
      const supabase = fastify.supabase;

      const targetIds = await resolveCommentRecipients(
        supabase, paymentRequestId, actorUserId, recipient,
      );

      await insertNotifications(supabase, targetIds.map((uid) => ({
        user_id: uid,
        type: 'new_comment',
        title: 'Новый комментарий',
        message: 'Добавлен комментарий к заявке',
        payment_request_id: paymentRequestId,
      })));

      return reply.send({ success: true });
    },
  );

  /** Новый файл — уведомление по текущему этапу заявки */
  fastify.post<{ Body: NewFileBody }>(
    '/api/notifications/payment-request/new-file',
    auth,
    async (request, reply) => {
      const { paymentRequestId, actorUserId } = request.body;
      const supabase = fastify.supabase;

      const targetIds = await resolveFileRecipients(
        supabase, paymentRequestId, actorUserId,
      );

      await insertNotifications(supabase, targetIds.map((uid) => ({
        user_id: uid,
        type: 'new_file',
        title: 'Новый файл',
        message: 'Добавлен файл к заявке',
        payment_request_id: paymentRequestId,
      })));

      return reply.send({ success: true });
    },
  );

  /** Проверка наличия специалиста подразделения — уведомление админам */
  fastify.post<{ Body: CheckSpecialistsBody }>(
    '/api/notifications/payment-request/check-specialists',
    auth,
    async (request, reply) => {
      const { paymentRequestId, siteId, department } = request.body;
      const supabase = fastify.supabase;

      const specialists = await getUsersByDepartmentAndSite(
        supabase, department, siteId,
      );

      if (specialists.length > 0) {
        return reply.send({ success: true });
      }

      // Специалистов нет — уведомляем администраторов
      const adminIds = await getAdminUserIds(supabase);
      const deptLabels: Record<string, string> = {
        omts: 'ОМТС',
        shtab: 'Штаб',
        smetny: 'Сметный',
      };
      const deptLabel = deptLabels[department] ?? department;

      await insertNotifications(supabase, adminIds.map((uid) => ({
        user_id: uid,
        type: 'missing_specialist',
        title: 'Нет специалиста подразделения',
        message: `Для объекта не назначен специалист «${deptLabel}»`,
        payment_request_id: paymentRequestId,
        site_id: siteId,
        department_id: department,
      })));

      return reply.send({ success: true });
    },
  );

  /* ================ Заявки на договор ================ */

  /** Новая заявка на договор — уведомление ОМТС */
  fastify.post<{ Body: ContractNewRequestBody }>(
    '/api/notifications/contract-request/new-request',
    auth,
    async (request, reply) => {
      const { contractRequestId, siteId, actorUserId, requestNumber } = request.body;
      const supabase = fastify.supabase;

      const userIds = await getUsersByDepartmentAndSite(
        supabase, 'omts', siteId, actorUserId,
      );

      const label = requestNumber ? ` N${requestNumber}` : '';
      await insertNotifications(supabase, userIds.map((uid) => ({
        user_id: uid,
        type: 'contract_new_request',
        title: 'Новая заявка на договор',
        message: `Поступила заявка на договор${label}`,
        contract_request_id: contractRequestId,
        site_id: siteId,
        department_id: 'omts' as const,
      })));

      return reply.send({ success: true });
    },
  );

  /** Смена статуса заявки на договор — уведомление создателю */
  fastify.post<{ Body: ContractStatusChangedBody }>(
    '/api/notifications/contract-request/status-changed',
    auth,
    async (request, reply) => {
      const { contractRequestId, statusLabel, actorUserId } = request.body;
      const supabase = fastify.supabase;

      const creatorId = await getContractRequestCreator(supabase, contractRequestId);
      if (!creatorId || creatorId === actorUserId) {
        return reply.send({ success: true });
      }

      await insertNotifications(supabase, [{
        user_id: creatorId,
        type: 'contract_status_changed',
        title: 'Изменён статус заявки на договор',
        message: `Статус заявки на договор изменён на «${statusLabel}»`,
        contract_request_id: contractRequestId,
      }]);

      return reply.send({ success: true });
    },
  );

  /** Доработка заявки на договор — уведомление целевым группам */
  fastify.post<{ Body: ContractRevisionBody }>(
    '/api/notifications/contract-request/revision',
    auth,
    async (request, reply) => {
      const { contractRequestId, targets, actorUserId } = request.body;
      const supabase = fastify.supabase;
      const info = await getContractRequestInfo(supabase, contractRequestId);
      if (!info) return reply.send({ success: true });

      const recipientIds = new Set<string>();

      for (const target of targets) {
        if (target === 'counterparty') {
          // Уведомить создателя заявки
          if (info.created_by && info.created_by !== actorUserId) {
            recipientIds.add(info.created_by);
          }
        } else if (target === 'shtab') {
          // Уведомить штаб объекта
          const ids = await getUsersByDepartmentAndSite(
            supabase, 'shtab', info.site_id, actorUserId,
          );
          ids.forEach((id) => recipientIds.add(id));
        }
      }

      await insertNotifications(supabase, Array.from(recipientIds).map((uid) => ({
        user_id: uid,
        type: 'contract_revision',
        title: 'Заявка на договор — доработка',
        message: 'Заявка на договор отправлена на доработку',
        contract_request_id: contractRequestId,
      })));

      return reply.send({ success: true });
    },
  );

  /** Новый комментарий к заявке на договор */
  fastify.post<{ Body: ContractNewCommentBody }>(
    '/api/notifications/contract-request/new-comment',
    auth,
    async (request, reply) => {
      const { contractRequestId, actorUserId, recipient } = request.body;
      const supabase = fastify.supabase;

      const targetIds = await resolveContractCommentRecipients(
        supabase, contractRequestId, actorUserId, recipient,
      );

      await insertNotifications(supabase, targetIds.map((uid) => ({
        user_id: uid,
        type: 'contract_new_comment',
        title: 'Новый комментарий',
        message: 'Добавлен комментарий к заявке на договор',
        contract_request_id: contractRequestId,
      })));

      return reply.send({ success: true });
    },
  );

  /** Новый файл к заявке на договор */
  fastify.post<{ Body: ContractNewFileBody }>(
    '/api/notifications/contract-request/new-file',
    auth,
    async (request, reply) => {
      const { contractRequestId, actorUserId } = request.body;
      const supabase = fastify.supabase;

      const targetIds = await resolveContractFileRecipients(
        supabase, contractRequestId, actorUserId,
      );

      await insertNotifications(supabase, targetIds.map((uid) => ({
        user_id: uid,
        type: 'contract_new_file',
        title: 'Новый файл',
        message: 'Добавлен файл к заявке на договор',
        contract_request_id: contractRequestId,
      })));

      return reply.send({ success: true });
    },
  );
}

export default notificationActionRoutes;
