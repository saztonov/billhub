/**
 * SupabaseRepository для оплат (Strangler Fig, rollback-инструмент).
 * Воспроизводит исходную логику routes/payments.ts (recalcPaidStatus, flattenPayment).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentRepository, PaymentRow, CreatePaymentInput } from '../payment.repository.js';
import type { UpdatePaymentBody, AddPaymentFileBody } from '../../schemas/payment.js';
import { NotFoundError } from '../types.js';

const PAYMENT_SELECT =
  'id, payment_request_id, payment_number, payment_date, amount, is_executed, created_by, updated_by, created_at, updated_at, payment_payment_files(id, payment_payment_id, file_name, file_key, file_size, mime_type, created_by, created_at)';

function flattenPayment(row: Record<string, unknown>): PaymentRow {
  const files = row.payment_payment_files as Record<string, unknown>[] | null;
  const flat = { ...row };
  delete flat.payment_payment_files;
  flat.files = files ?? [];
  return flat;
}

export class SupabasePaymentRepository implements PaymentRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /** Пересчёт total_paid + paid_status_id заявки (как recalcPaidStatus в роуте). */
  private async recalcPaidStatus(
    paymentRequestId: string,
  ): Promise<{ totalPaid: number; paidStatusId: string }> {
    const { data: paymentsData, error: pErr } = await this.supabase
      .from('payment_payments')
      .select('amount')
      .eq('payment_request_id', paymentRequestId)
      .eq('is_executed', true);
    if (pErr) throw pErr;
    const totalPaid = (paymentsData ?? []).reduce(
      (sum, p) => sum + Number((p as Record<string, unknown>).amount ?? 0),
      0,
    );

    const { data: reqData, error: rErr } = await this.supabase
      .from('payment_requests')
      .select('invoice_amount')
      .eq('id', paymentRequestId)
      .single();
    if (rErr) throw rErr;
    const invoiceAmount = Number(reqData.invoice_amount) || 0;

    let statusCode = 'not_paid';
    if (totalPaid > 0 && totalPaid < invoiceAmount) statusCode = 'partially_paid';
    else if (totalPaid > 0 && totalPaid >= invoiceAmount) statusCode = 'paid';

    const { data: statusData, error: sErr } = await this.supabase
      .from('statuses')
      .select('id')
      .eq('entity_type', 'paid')
      .eq('code', statusCode)
      .single();
    if (sErr) throw sErr;

    await this.supabase
      .from('payment_requests')
      .update({ total_paid: totalPaid, paid_status_id: statusData.id })
      .eq('id', paymentRequestId);

    return { totalPaid, paidStatusId: statusData.id as string };
  }

  private async nextPaymentNumber(paymentRequestId: string): Promise<number> {
    const { data: maxData } = await this.supabase
      .from('payment_payments')
      .select('payment_number')
      .eq('payment_request_id', paymentRequestId)
      .order('payment_number', { ascending: false })
      .limit(1);
    return maxData && maxData.length > 0
      ? ((maxData[0] as Record<string, unknown>).payment_number as number) + 1
      : 1;
  }

  private async paymentRequestIdOf(paymentId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('payment_payments')
      .select('payment_request_id')
      .eq('id', paymentId)
      .single();
    return (data?.payment_request_id as string | null) ?? null;
  }

  async listByPaymentRequest(paymentRequestId: string): Promise<PaymentRow[]> {
    const { data, error } = await this.supabase
      .from('payment_payments')
      .select(PAYMENT_SELECT)
      .eq('payment_request_id', paymentRequestId)
      .order('payment_number', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => flattenPayment(r as Record<string, unknown>));
  }

  async create(input: CreatePaymentInput): Promise<{ id: string }> {
    const nextNumber = await this.nextPaymentNumber(input.paymentRequestId);
    const { data: inserted, error } = await this.supabase
      .from('payment_payments')
      .insert({
        payment_request_id: input.paymentRequestId,
        payment_number: nextNumber,
        payment_date: input.paymentDate,
        amount: input.amount,
        created_by: input.createdBy,
      })
      .select('id')
      .single();
    if (error) throw error;
    await this.recalcPaidStatus(input.paymentRequestId);
    return { id: inserted.id as string };
  }

  async update(id: string, patch: UpdatePaymentBody, updatedBy: string): Promise<void> {
    const updates: Record<string, unknown> = {
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    };
    if (patch.paymentDate !== undefined) updates.payment_date = patch.paymentDate;
    if (patch.amount !== undefined) updates.amount = patch.amount;
    const { error } = await this.supabase.from('payment_payments').update(updates).eq('id', id);
    if (error) throw error;
    const prId = await this.paymentRequestIdOf(id);
    if (prId) await this.recalcPaidStatus(prId);
  }

  async delete(id: string): Promise<void> {
    const prId = await this.paymentRequestIdOf(id);
    if (prId === null) throw new NotFoundError('Payment', id);
    const { error } = await this.supabase.from('payment_payments').delete().eq('id', id);
    if (error) throw error;
    await this.recalcPaidStatus(prId);
  }

  async addFile(paymentId: string, file: AddPaymentFileBody, createdBy: string): Promise<void> {
    const { error } = await this.supabase.from('payment_payment_files').insert({
      payment_payment_id: paymentId,
      file_name: file.fileName,
      file_key: file.fileKey,
      file_size: file.fileSize,
      mime_type: file.mimeType,
      created_by: createdBy,
    });
    if (error) throw error;
    await this.supabase.from('payment_payments').update({ is_executed: true }).eq('id', paymentId);
    const prId = await this.paymentRequestIdOf(paymentId);
    if (prId) await this.recalcPaidStatus(prId);
  }

  async deleteFile(fileId: string, paymentId?: string): Promise<void> {
    const { error } = await this.supabase.from('payment_payment_files').delete().eq('id', fileId);
    if (error) throw error;
    if (paymentId) {
      const { data: remainingFiles } = await this.supabase
        .from('payment_payment_files')
        .select('id')
        .eq('payment_payment_id', paymentId)
        .limit(1);
      const hasFiles = (remainingFiles ?? []).length > 0;
      await this.supabase
        .from('payment_payments')
        .update({ is_executed: hasFiles })
        .eq('id', paymentId);
      const prId = await this.paymentRequestIdOf(paymentId);
      if (prId) await this.recalcPaidStatus(prId);
    }
  }

  async recalcStatus(
    paymentRequestId: string,
  ): Promise<{ totalPaid: number; paidStatusId: string | null }> {
    await this.recalcPaidStatus(paymentRequestId);
    const { data: reqData, error: rErr } = await this.supabase
      .from('payment_requests')
      .select('total_paid, paid_status_id')
      .eq('id', paymentRequestId)
      .single();
    if (rErr) throw rErr;
    return {
      totalPaid: Number(reqData.total_paid) || 0,
      paidStatusId: (reqData.paid_status_id as string | null) ?? null,
    };
  }
}
