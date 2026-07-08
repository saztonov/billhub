/**
 * NotificationActionRepository — создание уведомлений по бизнес-событиям
 * (смена статуса, доработка, назначение, комментарии/файлы, проверка специалистов и т.д.).
 *
 * Каждый метод инкапсулирует выбор получателей + текст + вставку уведомлений.
 * Strangler Fig: Supabase-реализация переиспользует services/notification-helpers.ts;
 * Drizzle-реализация воспроизводит ту же логику на Drizzle (записи — в db.transaction()).
 */
import type {
  PaymentStatusChangedBody,
  PaymentRevisionBody,
  PaymentNewPendingBody,
  PaymentResubmittedBody,
  PaymentAssignedBody,
  PaymentNewCommentBody,
  PaymentNewFileBody,
  CheckSpecialistsBody,
  ContractNewRequestBody,
  ContractStatusChangedBody,
  ContractRevisionBody,
  ContractNewCommentBody,
  ContractNewFileBody,
} from '../schemas/notification-action.js';

export interface NotificationActionRepository {
  /* --- Заявки на оплату --- */
  paymentStatusChanged(body: PaymentStatusChangedBody): Promise<void>;
  paymentRevision(body: PaymentRevisionBody): Promise<void>;
  paymentNewPending(body: PaymentNewPendingBody): Promise<void>;
  paymentResubmitted(body: PaymentResubmittedBody): Promise<void>;
  paymentAssigned(body: PaymentAssignedBody): Promise<void>;
  paymentNewComment(body: PaymentNewCommentBody): Promise<void>;
  paymentNewFile(body: PaymentNewFileBody): Promise<void>;
  checkSpecialists(body: CheckSpecialistsBody): Promise<void>;

  /* --- Заявки на договор --- */
  contractNewRequest(body: ContractNewRequestBody): Promise<void>;
  contractStatusChanged(body: ContractStatusChangedBody): Promise<void>;
  contractRevision(body: ContractRevisionBody): Promise<void>;
  contractNewComment(body: ContractNewCommentBody): Promise<void>;
  contractNewFile(body: ContractNewFileBody): Promise<void>;
}
