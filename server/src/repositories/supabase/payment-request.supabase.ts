/**
 * SupabaseRepository для заявок на оплату (Strangler Fig, rollback-инструмент).
 * Воспроизводит исходную логику роутов payment-requests/extra (PostgREST-джойны, helpers).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PaymentRequestRepository,
  PaymentRequestListFilter,
  PaymentRequestRow,
  CreatePaymentRequestInput,
} from '../payment-request.repository.js';
import type {
  UpdatePaymentRequestBody,
  ResubmitBody,
  DpDataBody,
  AddPaymentRequestFileBody,
} from '../../schemas/payment-request.js';
import { NotFoundError, ForbiddenError } from '../types.js';

const PR_LIST_SELECT = `
  *,
  counterparties(name, inn),
  suppliers(name, inn, last_security_status),
  construction_sites(name),
  statuses!payment_requests_status_id_fkey(name, color),
  paid_statuses:statuses!payment_requests_paid_status_id_fkey(name, color),
  shipping:payment_request_field_options!payment_requests_shipping_condition_id_fkey(value),
  cost_types(name),
  current_assignment:payment_request_assignments!left(
    assigned_user_id,
    is_current,
    assigned_user:users!payment_request_assignments_assigned_user_id_fkey(email, full_name)
  )
`;

function flattenPaymentRequest(row: Record<string, unknown>): PaymentRequestRow {
  const cp = row.counterparties as Record<string, unknown> | null;
  const sup = row.suppliers as Record<string, unknown> | null;
  const site = row.construction_sites as Record<string, unknown> | null;
  const status = row.statuses as Record<string, unknown> | null;
  const paidStatus = row.paid_statuses as Record<string, unknown> | null;
  const shipping = row.shipping as Record<string, unknown> | null;
  const costType = row.cost_types as Record<string, unknown> | null;
  const assignments = row.current_assignment as Record<string, unknown>[] | null;
  const current = assignments?.find((a) => a.is_current) ?? null;
  const assignedUser = current?.assigned_user as Record<string, unknown> | null;

  const flat = { ...row };
  delete flat.counterparties;
  delete flat.suppliers;
  delete flat.construction_sites;
  delete flat.statuses;
  delete flat.paid_statuses;
  delete flat.shipping;
  delete flat.cost_types;
  delete flat.current_assignment;

  flat.counterparty_name = cp?.name ?? null;
  flat.counterparty_inn = cp?.inn ?? null;
  flat.supplier_name = sup?.name ?? null;
  flat.supplier_inn = sup?.inn ?? null;
  flat.supplier_last_security_status = sup?.last_security_status ?? null;
  flat.site_name = site?.name ?? null;
  flat.status_name = status?.name ?? null;
  flat.status_color = status?.color ?? null;
  flat.paid_status_name = paidStatus?.name ?? null;
  flat.paid_status_color = paidStatus?.color ?? null;
  flat.shipping_condition_value = shipping?.value ?? null;
  flat.cost_type_name = costType?.name ?? null;
  flat.assigned_user_id = current?.assigned_user_id ?? null;
  flat.assigned_user_email = assignedUser?.email ?? null;
  flat.assigned_user_full_name = assignedUser?.full_name ?? null;

  return flat;
}

export class SupabasePaymentRequestRepository implements PaymentRequestRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  private async getStatusId(entityType: string, code: string): Promise<string> {
    const { data, error } = await this.supabase
      .from('statuses')
      .select('id')
      .eq('entity_type', entityType)
      .eq('code', code)
      .single();
    if (error || !data) throw new Error(`Статус ${entityType}/${code} не найден`);
    return data.id as string;
  }

  private async appendStageHistory(
    paymentRequestId: string,
    entry: Record<string, unknown>,
  ): Promise<void> {
    const { data } = await this.supabase
      .from('payment_requests')
      .select('stage_history')
      .eq('id', paymentRequestId)
      .single();
    const history = (data?.stage_history as Record<string, unknown>[]) ?? [];
    history.push({ ...entry, at: new Date().toISOString() });
    await this.supabase
      .from('payment_requests')
      .update({ stage_history: history })
      .eq('id', paymentRequestId);
  }

  async getUserSiteIds(userId: string): Promise<string[]> {
    const { data } = await this.supabase
      .from('user_construction_sites_mapping')
      .select('construction_site_id')
      .eq('user_id', userId);
    return (data ?? []).map((s: Record<string, unknown>) => s.construction_site_id as string);
  }

  async list(filter: PaymentRequestListFilter): Promise<PaymentRequestRow[]> {
    if (filter.siteIds && filter.siteIds.length === 0) return [];

    let q = this.supabase
      .from('payment_requests')
      .select(PR_LIST_SELECT)
      .order('created_at', { ascending: false });

    if (!filter.showDeleted) q = q.eq('is_deleted', false);
    if (filter.counterpartyId) q = q.eq('counterparty_id', filter.counterpartyId);
    if (filter.siteIds && filter.siteIds.length > 0) q = q.in('site_id', filter.siteIds);
    if (filter.supplierId) q = q.eq('supplier_id', filter.supplierId);
    if (filter.siteId) q = q.eq('site_id', filter.siteId);
    if (filter.statusId) q = q.eq('status_id', filter.statusId);
    if (filter.costTypeId) q = q.eq('cost_type_id', filter.costTypeId);
    if (filter.dateFrom) q = q.gte('created_at', filter.dateFrom);
    if (filter.dateTo) q = q.lte('created_at', filter.dateTo + 'T23:59:59.999Z');
    if (filter.search) q = q.or(`request_number.ilike.%${filter.search}%`);
    if (filter.pagination) {
      const from = (filter.pagination.page - 1) * filter.pagination.pageSize;
      q = q.range(from, from + filter.pagination.pageSize - 1);
    }

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((row) => flattenPaymentRequest(row as Record<string, unknown>));
  }

  async getById(id: string): Promise<PaymentRequestRow | null> {
    const { data, error } = await this.supabase
      .from('payment_requests')
      .select(PR_LIST_SELECT)
      .eq('id', id)
      .single();
    if (error || !data) return null;
    return flattenPaymentRequest(data as Record<string, unknown>);
  }

  async getOwnerCounterpartyId(id: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('payment_requests')
      .select('counterparty_id')
      .eq('id', id)
      .single();
    if (error || !data) return null;
    return (data.counterparty_id as string | null) ?? null;
  }

  async create(
    input: CreatePaymentRequestInput,
  ): Promise<{ requestId: string; requestNumber: string }> {
    const statusId = await this.getStatusId('payment_request', 'approv_shtab');

    const { data: requestNumber, error: numError } =
      await this.supabase.rpc('generate_request_number');
    if (numError) throw numError;

    const { data: created, error: reqError } = await this.supabase
      .from('payment_requests')
      .insert({
        request_number: requestNumber,
        counterparty_id: input.counterpartyId,
        site_id: input.siteId,
        status_id: statusId,
        delivery_days: input.deliveryDays,
        delivery_days_type: input.deliveryDaysType,
        shipping_condition_id: input.shippingConditionId,
        comment: input.comment || null,
        invoice_amount: input.invoiceAmount || null,
        supplier_id: input.supplierId || null,
        total_files: input.totalFiles,
        uploaded_files: 0,
        created_by: input.createdBy,
      })
      .select('id')
      .single();
    if (reqError) throw reqError;
    const requestId = created.id as string;

    await this.supabase.from('approval_decisions').insert({
      payment_request_id: requestId,
      stage_order: 1,
      department_id: 'shtab',
      status: 'pending',
    });

    await this.appendStageHistory(requestId, { stage: 1, department: 'shtab', event: 'received' });

    await this.supabase.from('payment_requests').update({ current_stage: 1 }).eq('id', requestId);

    return { requestId, requestNumber: requestNumber as string };
  }

  async update(
    id: string,
    patch: UpdatePaymentRequestBody,
    ctx: { userId: string; actingCounterpartyId?: string | null },
  ): Promise<void> {
    const { data: current, error: fetchErr } = await this.supabase
      .from('payment_requests')
      .select(
        'delivery_days, delivery_days_type, shipping_condition_id, site_id, comment, invoice_amount, invoice_amount_history, total_files, supplier_id, counterparty_id',
      )
      .eq('id', id)
      .single();
    if (fetchErr || !current) throw new NotFoundError('PaymentRequest', id);

    const cur = current as Record<string, unknown>;
    if (ctx.actingCounterpartyId != null && cur.counterparty_id !== ctx.actingCounterpartyId) {
      throw new ForbiddenError();
    }

    const updates: Record<string, unknown> = {};
    const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];
    const fieldMap: Record<string, string> = {
      deliveryDays: 'delivery_days',
      deliveryDaysType: 'delivery_days_type',
      shippingConditionId: 'shipping_condition_id',
      siteId: 'site_id',
      comment: 'comment',
      invoiceAmount: 'invoice_amount',
      supplierId: 'supplier_id',
    };
    const body = patch as Record<string, unknown>;
    for (const [camel, snake] of Object.entries(fieldMap)) {
      if (body[camel] !== undefined && body[camel] !== cur[snake]) {
        updates[snake] = body[camel] ?? null;
        changes.push({ field: snake, oldValue: cur[snake], newValue: body[camel] ?? null });
      }
    }

    const invoiceAmountReason = patch.invoiceAmountReason;
    if (
      updates.invoice_amount !== undefined &&
      invoiceAmountReason === 'amount_change' &&
      cur.invoice_amount != null
    ) {
      const history = (cur.invoice_amount_history as { amount: number; changedAt: string }[]) ?? [];
      history.push({ amount: cur.invoice_amount as number, changedAt: new Date().toISOString() });
      updates.invoice_amount_history = history;
    }

    if (patch.newFilesCount && patch.newFilesCount > 0) {
      updates.total_files = ((cur.total_files as number) ?? 0) + patch.newFilesCount;
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await this.supabase.from('payment_requests').update(updates).eq('id', id);
      if (error) throw error;
    }

    if (changes.length > 0) {
      const details: Record<string, unknown> = { changes };
      if (invoiceAmountReason && updates.invoice_amount !== undefined) {
        details.invoiceAmountReason = invoiceAmountReason;
      }
      await this.supabase
        .from('payment_request_logs')
        .insert({ payment_request_id: id, user_id: ctx.userId, action: 'edit', details });
    }
  }

  async softDelete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('payment_requests')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }

  async withdraw(id: string, comment?: string | null): Promise<void> {
    const statusId = await this.getStatusId('payment_request', 'withdrawn');
    const { error } = await this.supabase
      .from('payment_requests')
      .update({
        status_id: statusId,
        withdrawn_at: new Date().toISOString(),
        withdrawal_comment: comment || null,
      })
      .eq('id', id);
    if (error) throw error;
  }

  async resubmit(id: string, input: ResubmitBody, userId: string): Promise<void> {
    const statusId = await this.getStatusId('payment_request', 'approv_shtab');

    const { data: cur, error: curErr } = await this.supabase
      .from('payment_requests')
      .select('resubmit_count, rejected_stage, site_id, invoice_amount, invoice_amount_history')
      .eq('id', id)
      .single();
    if (curErr || !cur) throw new NotFoundError('PaymentRequest', id);

    const newCount = ((cur.resubmit_count as number) ?? 0) + 1;
    const updateData: Record<string, unknown> = {
      status_id: statusId,
      rejected_at: null,
      rejected_stage: null,
      approved_at: null,
      current_stage: 1,
      resubmit_comment: input.comment || null,
      resubmit_count: newCount,
      // Реактивация: снимаем флаг отзыва, иначе заявка выпадет из pending-списков (миграция 004).
      withdrawn_at: null,
      withdrawal_comment: null,
    };

    if (input.fieldUpdates) {
      const history = (cur.invoice_amount_history as { amount: number; changedAt: string }[]) ?? [];
      if (cur.invoice_amount != null) {
        history.push({ amount: cur.invoice_amount as number, changedAt: new Date().toISOString() });
      }
      updateData.invoice_amount_history = history;
      updateData.delivery_days = input.fieldUpdates.deliveryDays;
      updateData.delivery_days_type = input.fieldUpdates.deliveryDaysType;
      updateData.shipping_condition_id = input.fieldUpdates.shippingConditionId;
      updateData.invoice_amount = input.fieldUpdates.invoiceAmount;
    }

    const { error: updErr } = await this.supabase
      .from('payment_requests')
      .update(updateData)
      .eq('id', id);
    if (updErr) throw updErr;

    await this.supabase
      .from('approval_decisions')
      .delete()
      .eq('payment_request_id', id)
      .eq('stage_order', 1)
      .eq('department_id', 'shtab')
      .eq('status', 'pending');

    await this.supabase.from('approval_decisions').insert({
      payment_request_id: id,
      stage_order: 1,
      department_id: 'shtab',
      status: 'pending',
    });

    await this.appendStageHistory(id, { stage: 1, department: 'shtab', event: 'received' });

    await this.supabase.from('payment_request_logs').insert({
      payment_request_id: id,
      user_id: userId,
      action: 'resubmit',
      details: {
        comment: input.comment,
        fileCount: input.fileCount ?? 0,
        target_stage: 1,
        target_department: 'shtab',
        resubmit_count: newCount,
      },
    });
  }

  async setStatus(id: string, statusId: string): Promise<void> {
    const { error } = await this.supabase
      .from('payment_requests')
      .update({ status_id: statusId })
      .eq('id', id);
    if (error) throw error;
  }

  async setDpData(id: string, dp: DpDataBody): Promise<void> {
    const { error } = await this.supabase
      .from('payment_requests')
      .update({
        dp_number: dp.dpNumber,
        dp_date: dp.dpDate,
        dp_amount: dp.dpAmount,
        dp_file_key: dp.dpFileKey,
        dp_file_name: dp.dpFileName,
      })
      .eq('id', id);
    if (error) throw error;
  }

  /** РП-реестр реализован только на Drizzle — в supabase-bridge заявка в РП не входит. */
  async isInRpLetter(_id: string): Promise<boolean> {
    return false;
  }

  /** РП-реестр реализован только на Drizzle — файлов «РП» из rp-letters/… в supabase-bridge нет. */
  async isDpFileOfCounterparty(_fileKey: string, _counterpartyId: string): Promise<boolean> {
    return false;
  }

  async listFiles(paymentRequestId: string): Promise<PaymentRequestRow[]> {
    const { data, error } = await this.supabase
      .from('payment_request_files')
      .select(
        '*, document_types(name), users!payment_request_files_created_by_fkey(role, department_id, counterparties(name))',
      )
      .eq('payment_request_id', paymentRequestId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r: Record<string, unknown>) => {
      const docType = r.document_types as { name: string } | null;
      const uploader = r.users as {
        role: string;
        department_id: string | null;
        counterparties: { name: string } | null;
      } | null;
      return {
        ...r,
        document_type_name: docType?.name ?? null,
        uploader_role: uploader?.role ?? null,
        uploader_department: uploader?.department_id ?? null,
        uploader_counterparty_name: uploader?.counterparties?.name ?? null,
        document_types: undefined,
        users: undefined,
      };
    });
  }

  async addFile(paymentRequestId: string, file: AddPaymentRequestFileBody): Promise<void> {
    const { error: insErr } = await this.supabase.from('payment_request_files').insert({
      payment_request_id: paymentRequestId,
      document_type_id: file.documentTypeId,
      file_name: file.fileName,
      file_key: file.fileKey,
      file_size: file.fileSize,
      mime_type: file.mimeType ?? null,
      page_count: file.pageCount ?? null,
      created_by: file.userId,
      is_resubmit: file.isResubmit ?? false,
      is_additional: file.isAdditional ?? false,
    });
    if (insErr) throw insErr;

    const { data: req, error: fetchErr } = await this.supabase
      .from('payment_requests')
      .select('uploaded_files, total_files')
      .eq('id', paymentRequestId)
      .single();
    if (fetchErr || !req) throw new Error('Ошибка обновления счётчика файлов');

    const updates: Record<string, number> = {
      uploaded_files: ((req.uploaded_files as number) ?? 0) + 1,
    };
    if (file.isAdditional || file.isResubmit) {
      updates.total_files = ((req.total_files as number) ?? 0) + 1;
    }
    const { error: updErr } = await this.supabase
      .from('payment_requests')
      .update(updates)
      .eq('id', paymentRequestId);
    if (updErr) throw new Error('Ошибка обновления счётчика файлов');
  }

  async getFileRejection(fileId: string): Promise<boolean | null> {
    const { data, error } = await this.supabase
      .from('payment_request_files')
      .select('is_rejected')
      .eq('id', fileId)
      .single();
    if (error || !data) return null;
    return (data.is_rejected as boolean) ?? false;
  }

  async setFileRejection(
    fileId: string,
    isRejected: boolean,
    rejectedBy: string | null,
  ): Promise<void> {
    const updateData = isRejected
      ? { is_rejected: true, rejected_by: rejectedBy, rejected_at: new Date().toISOString() }
      : { is_rejected: false, rejected_by: null, rejected_at: null };
    const { error } = await this.supabase
      .from('payment_request_files')
      .update(updateData)
      .eq('id', fileId);
    if (error) throw error;
  }

  async getRequestNumber(id: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('payment_requests')
      .select('request_number')
      .eq('id', id)
      .single();
    if (error || !data) return null;
    return data.request_number as string;
  }
}
