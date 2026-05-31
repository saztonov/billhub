/**
 * SupabaseRepository для notification-actions (Strangler Fig, rollback-инструмент).
 * Переиспользует services/notification-helpers.ts (логика выбора получателей).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationActionRepository } from '../notification-action.repository.js';
import type {
  PaymentStatusChangedBody,
  PaymentRevisionBody,
  PaymentNewPendingBody,
  PaymentResubmittedBody,
  OmtsRpPendingBody,
  PaymentAssignedBody,
  PaymentNewCommentBody,
  PaymentNewFileBody,
  CheckSpecialistsBody,
  ContractNewRequestBody,
  ContractStatusChangedBody,
  ContractRevisionBody,
  ContractNewCommentBody,
  ContractNewFileBody,
} from '../../schemas/notification-action.js';
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
  type NotificationInsert,
} from '../../services/notification-helpers.js';

const DEPT_LABELS: Record<string, string> = { omts: 'ОМТС', shtab: 'Штаб', smetny: 'Сметный' };

export class SupabaseNotificationActionRepository implements NotificationActionRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  private async label(
    table: 'payment_requests' | 'contract_requests',
    id: string,
  ): Promise<string> {
    const { data } = await this.supabase.from(table).select('request_number').eq('id', id).single();
    const num = (data as { request_number?: string | null } | null)?.request_number;
    return num ? ` N${num}` : '';
  }

  /* ----------------------------- Заявки на оплату ----------------------------- */

  async paymentStatusChanged(body: PaymentStatusChangedBody): Promise<void> {
    const { paymentRequestId, statusLabel, actorUserId } = body;
    const creatorId = await getPaymentRequestCreator(this.supabase, paymentRequestId);
    if (!creatorId || creatorId === actorUserId) return;
    const label = await this.label('payment_requests', paymentRequestId);
    await insertNotifications(this.supabase, [
      {
        user_id: creatorId,
        type: 'status_changed',
        title: 'Изменён статус заявки',
        message: `Статус заявки${label} изменён на «${statusLabel}»`,
        payment_request_id: paymentRequestId,
      },
    ]);
  }

  async paymentRevision(body: PaymentRevisionBody): Promise<void> {
    const { paymentRequestId, actorUserId } = body;
    const creatorId = await getPaymentRequestCreator(this.supabase, paymentRequestId);
    if (!creatorId || creatorId === actorUserId) return;
    const label = await this.label('payment_requests', paymentRequestId);
    await insertNotifications(this.supabase, [
      {
        user_id: creatorId,
        type: 'status_changed',
        title: 'Заявка отправлена на доработку',
        message: `Заявка${label} отправлена на доработку`,
        payment_request_id: paymentRequestId,
      },
    ]);
  }

  async paymentNewPending(body: PaymentNewPendingBody): Promise<void> {
    const { paymentRequestId, siteId, actorUserId, requestNumber } = body;
    const userIds = await getUsersByDepartmentAndSite(this.supabase, 'shtab', siteId, actorUserId);
    const label = requestNumber ? ` N${requestNumber}` : '';
    await insertNotifications(
      this.supabase,
      userIds.map((uid) => ({
        user_id: uid,
        type: 'new_pending',
        title: 'Новая заявка на согласовании',
        message: `Поступила заявка${label} на согласование`,
        payment_request_id: paymentRequestId,
        site_id: siteId,
        department_id: 'shtab' as const,
      })),
    );
  }

  async paymentResubmitted(body: PaymentResubmittedBody): Promise<void> {
    const { paymentRequestId, actorUserId, rejectedStage } = body;
    const { data: req } = await this.supabase
      .from('payment_requests')
      .select('site_id, request_number')
      .eq('id', paymentRequestId)
      .single();
    if (!req) return;
    const siteId = (req as { site_id: string }).site_id;
    const requestNumber = (req as { request_number: string | null }).request_number;
    const label = requestNumber ? ` N${requestNumber}` : '';

    const shtabIds = await getUsersByDepartmentAndSite(this.supabase, 'shtab', siteId, actorUserId);
    const notifications: NotificationInsert[] = shtabIds.map((uid) => ({
      user_id: uid,
      type: 'resubmitted',
      title: 'Повторная отправка заявки',
      message: `Заявка${label} отправлена повторно на согласование`,
      payment_request_id: paymentRequestId,
      site_id: siteId,
      department_id: 'shtab',
    }));

    if (rejectedStage === 2) {
      const omtsIds = await getUsersByDepartmentAndSite(this.supabase, 'omts', siteId, actorUserId);
      for (const uid of omtsIds) {
        notifications.push({
          user_id: uid,
          type: 'resubmitted',
          title: 'Повторная отправка заявки',
          message: `Заявка${label} отправлена повторно на согласование`,
          payment_request_id: paymentRequestId,
          site_id: siteId,
          department_id: 'omts',
        });
      }
    }
    await insertNotifications(this.supabase, notifications);
  }

  async omtsRpPending(body: OmtsRpPendingBody): Promise<void> {
    const { paymentRequestId, actorUserId } = body;
    const userIds = await getOmtsRpUsers(this.supabase, paymentRequestId);
    const filtered = userIds.filter((id) => id !== actorUserId);
    const label = await this.label('payment_requests', paymentRequestId);
    await insertNotifications(
      this.supabase,
      filtered.map((uid) => ({
        user_id: uid,
        type: 'omts_rp_pending',
        title: 'Заявка на согласовании ОМТС',
        message: `Заявка${label} поступила на согласование ОМТС РП`,
        payment_request_id: paymentRequestId,
      })),
    );
  }

  async paymentAssigned(body: PaymentAssignedBody): Promise<void> {
    const { paymentRequestId, assignedUserId, actorUserId } = body;
    if (assignedUserId === actorUserId) return;
    const label = await this.label('payment_requests', paymentRequestId);
    await insertNotifications(this.supabase, [
      {
        user_id: assignedUserId,
        type: 'assigned',
        title: 'Вы назначены ответственным',
        message: `Вам назначена заявка${label} на обработку`,
        payment_request_id: paymentRequestId,
      },
    ]);
  }

  async paymentNewComment(body: PaymentNewCommentBody): Promise<void> {
    const { paymentRequestId, actorUserId, recipient } = body;
    const targetIds = await resolveCommentRecipients(
      this.supabase,
      paymentRequestId,
      actorUserId,
      recipient,
    );
    const label = await this.label('payment_requests', paymentRequestId);
    await insertNotifications(
      this.supabase,
      targetIds.map((uid) => ({
        user_id: uid,
        type: 'new_comment',
        title: 'Новый комментарий',
        message: `Добавлен комментарий к заявке${label}`,
        payment_request_id: paymentRequestId,
      })),
    );
  }

  async paymentNewFile(body: PaymentNewFileBody): Promise<void> {
    const { paymentRequestId, actorUserId } = body;
    const targetIds = await resolveFileRecipients(this.supabase, paymentRequestId, actorUserId);
    const label = await this.label('payment_requests', paymentRequestId);
    await insertNotifications(
      this.supabase,
      targetIds.map((uid) => ({
        user_id: uid,
        type: 'new_file',
        title: 'Новый файл',
        message: `Добавлен файл к заявке${label}`,
        payment_request_id: paymentRequestId,
      })),
    );
  }

  async checkSpecialists(body: CheckSpecialistsBody): Promise<void> {
    const { paymentRequestId, siteId, department } = body;
    const specialists = await getUsersByDepartmentAndSite(this.supabase, department, siteId);
    if (specialists.length > 0) return;
    const adminIds = await getAdminUserIds(this.supabase);
    const deptLabel = DEPT_LABELS[department] ?? department;
    await insertNotifications(
      this.supabase,
      adminIds.map((uid) => ({
        user_id: uid,
        type: 'missing_specialist',
        title: 'Нет специалиста подразделения',
        message: `Для объекта не назначен специалист «${deptLabel}»`,
        payment_request_id: paymentRequestId,
        site_id: siteId,
        department_id: department,
      })),
    );
  }

  /* ----------------------------- Заявки на договор ----------------------------- */

  async contractNewRequest(body: ContractNewRequestBody): Promise<void> {
    const { contractRequestId, siteId, actorUserId, requestNumber } = body;
    const userIds = await getUsersByDepartmentAndSite(this.supabase, 'omts', siteId, actorUserId);
    const label = requestNumber ? ` N${requestNumber}` : '';
    await insertNotifications(
      this.supabase,
      userIds.map((uid) => ({
        user_id: uid,
        type: 'contract_new_request',
        title: 'Новая заявка на договор',
        message: `Поступила заявка на договор${label}`,
        contract_request_id: contractRequestId,
        site_id: siteId,
        department_id: 'omts' as const,
      })),
    );
  }

  async contractStatusChanged(body: ContractStatusChangedBody): Promise<void> {
    const { contractRequestId, statusLabel, actorUserId } = body;
    const creatorId = await getContractRequestCreator(this.supabase, contractRequestId);
    if (!creatorId || creatorId === actorUserId) return;
    const label = await this.label('contract_requests', contractRequestId);
    await insertNotifications(this.supabase, [
      {
        user_id: creatorId,
        type: 'contract_status_changed',
        title: 'Изменён статус заявки на договор',
        message: `Статус заявки на договор${label} изменён на «${statusLabel}»`,
        contract_request_id: contractRequestId,
      },
    ]);
  }

  async contractRevision(body: ContractRevisionBody): Promise<void> {
    const { contractRequestId, targets, actorUserId } = body;
    const info = await getContractRequestInfo(this.supabase, contractRequestId);
    if (!info) return;

    const recipientIds = new Set<string>();
    for (const target of targets) {
      if (target === 'counterparty') {
        if (info.created_by && info.created_by !== actorUserId) recipientIds.add(info.created_by);
      } else if (target === 'shtab') {
        const ids = await getUsersByDepartmentAndSite(
          this.supabase,
          'shtab',
          info.site_id,
          actorUserId,
        );
        ids.forEach((id) => recipientIds.add(id));
      }
    }
    const label = info.request_number ? ` N${info.request_number}` : '';
    await insertNotifications(
      this.supabase,
      Array.from(recipientIds).map((uid) => ({
        user_id: uid,
        type: 'contract_revision',
        title: 'Заявка на договор — доработка',
        message: `Заявка на договор${label} отправлена на доработку`,
        contract_request_id: contractRequestId,
      })),
    );
  }

  async contractNewComment(body: ContractNewCommentBody): Promise<void> {
    const { contractRequestId, actorUserId, recipient } = body;
    const targetIds = await resolveContractCommentRecipients(
      this.supabase,
      contractRequestId,
      actorUserId,
      recipient,
    );
    const label = await this.label('contract_requests', contractRequestId);
    await insertNotifications(
      this.supabase,
      targetIds.map((uid) => ({
        user_id: uid,
        type: 'contract_new_comment',
        title: 'Новый комментарий',
        message: `Добавлен комментарий к заявке на договор${label}`,
        contract_request_id: contractRequestId,
      })),
    );
  }

  async contractNewFile(body: ContractNewFileBody): Promise<void> {
    const { contractRequestId, actorUserId } = body;
    const targetIds = await resolveContractFileRecipients(
      this.supabase,
      contractRequestId,
      actorUserId,
    );
    const label = await this.label('contract_requests', contractRequestId);
    await insertNotifications(
      this.supabase,
      targetIds.map((uid) => ({
        user_id: uid,
        type: 'contract_new_file',
        title: 'Новый файл',
        message: `Добавлен файл к заявке на договор${label}`,
        contract_request_id: contractRequestId,
      })),
    );
  }
}
