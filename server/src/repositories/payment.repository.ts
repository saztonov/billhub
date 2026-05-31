/**
 * PaymentRepository — оплаты по заявке (payment_payments + payment_payment_files).
 * Кросс-доменно обновляет payment_requests.total_paid / paid_status_id (recalc).
 * Strangler Fig: Supabase (rollback) и Drizzle. Записи — в db.transaction().
 *
 * Финальность оплаты: total_paid = сумма ИСПОЛНЕННЫХ (is_executed) оплат;
 * paid_status (entity_type='paid'): not_paid / partially_paid / paid по сравнению с invoice_amount.
 */
import type { UpdatePaymentBody, AddPaymentFileBody } from '../schemas/payment.js';

export type PaymentRow = Record<string, unknown>;

export interface CreatePaymentInput {
  paymentRequestId: string;
  paymentDate: string;
  amount: number;
  createdBy: string;
}

export interface PaymentRepository {
  /** Оплаты заявки с вложенными файлами (files: [...]), order payment_number ASC. */
  listByPaymentRequest(paymentRequestId: string): Promise<PaymentRow[]>;

  /** Создать оплату (next payment_number) + recalc. Возвращает id. */
  create(input: CreatePaymentInput): Promise<{ id: string }>;

  /** Обновить оплату (always updated_by/updated_at; conditional date/amount) + recalc. Без NotFound. */
  update(id: string, patch: UpdatePaymentBody, updatedBy: string): Promise<void>;

  /** Удалить оплату (файлы каскадно) + recalc. Бросает NotFoundError если не найдена. */
  delete(id: string): Promise<void>;

  /** Добавить файл оплаты → is_executed=true + recalc. Без NotFound. */
  addFile(paymentId: string, file: AddPaymentFileBody, createdBy: string): Promise<void>;

  /** Удалить файл; если paymentId задан — пересчитать is_executed + recalc. */
  deleteFile(fileId: string, paymentId?: string): Promise<void>;

  /** Явный пересчёт; возвращает обновлённые total_paid (number) и paid_status_id. */
  recalcStatus(
    paymentRequestId: string,
  ): Promise<{ totalPaid: number; paidStatusId: string | null }>;
}
