/**
 * Хелперы Supabase-реализации согласований (перенесены из routes/approval-helpers.ts в Iteration 5).
 * Используются ТОЛЬКО SupabaseApprovalRepository (rollback-провайдер). Drizzle-реализация
 * воспроизводит эту же логику средствами ORM. Все функции принимают клиент аргументом.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Получить id статуса по entity_type и code */
export async function getStatusId(
  supabase: SupabaseClient,
  entityType: string,
  code: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('statuses')
    .select('id')
    .eq('entity_type', entityType)
    .eq('code', code)
    .single();
  if (error || !data) throw new Error(`Статус ${entityType}/${code} не найден`);
  return data.id as string;
}

/** Добавить запись в stage_history заявки */
export async function appendStageHistory(
  supabase: SupabaseClient,
  paymentRequestId: string,
  entry: Record<string, unknown>,
): Promise<void> {
  const { data } = await supabase
    .from('payment_requests')
    .select('stage_history')
    .eq('id', paymentRequestId)
    .single();
  const history = (data?.stage_history as Record<string, unknown>[]) ?? [];
  history.push({ ...entry, at: new Date().toISOString() });
  await supabase
    .from('payment_requests')
    .update({ stage_history: history })
    .eq('id', paymentRequestId);
}

/** Получить email и full_name пользователя */
export async function getUserInfo(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ email?: string; fullName?: string }> {
  const { data } = await supabase
    .from('users')
    .select('email, full_name')
    .eq('id', userId)
    .single();
  return {
    email: data?.email as string | undefined,
    fullName: data?.full_name as string | undefined,
  };
}

/** Получить id объектов пользователя */
export async function getUserSiteIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ allSites: boolean; siteIds: string[] }> {
  const { data: userData } = await supabase
    .from('users')
    .select('all_sites')
    .eq('id', userId)
    .single();
  const allSites = (userData?.all_sites as boolean) ?? false;
  if (allSites) return { allSites: true, siteIds: [] };

  const { data: siteMappings } = await supabase
    .from('user_construction_sites_mapping')
    .select('construction_site_id')
    .eq('user_id', userId);
  const siteIds = (siteMappings ?? []).map(
    (s: Record<string, unknown>) => s.construction_site_id as string,
  );
  return { allSites: false, siteIds };
}

/** Обработка отправки на доработку */
export async function handleSendToRevision(
  supabase: SupabaseClient,
  paymentRequestId: string,
  userId: string,
  comment: string,
): Promise<{ success: boolean; error?: string; status?: number }> {
  const revisionStatusId = await getStatusId(supabase, 'payment_request', 'revision');
  const { data: currentReq, error: reqErr } = await supabase
    .from('payment_requests')
    .select('status_id, current_stage, approved_at')
    .eq('id', paymentRequestId)
    .single();
  if (reqErr) return { success: false, error: 'Заявка не найдена', status: 404 };

  // Запрет запуска цикла доработки из финальных статусов (опираемся на код статуса, не на rejected_at)
  const { data: curStatus } = await supabase
    .from('statuses')
    .select('code')
    .eq('id', currentReq.status_id as string)
    .single();
  if (curStatus?.code === 'rejected') {
    return {
      success: false,
      error: 'Нельзя отправить на доработку отклонённую заявку',
      status: 400,
    };
  }

  const updateData: Record<string, unknown> = {
    status_id: revisionStatusId,
    previous_status_id: currentReq.status_id,
  };
  if (currentReq.approved_at) updateData.approved_at = null;

  const { error: updErr } = await supabase
    .from('payment_requests')
    .update(updateData)
    .eq('id', paymentRequestId);
  if (updErr) return { success: false, error: updErr.message, status: 500 };

  const userInfo = await getUserInfo(supabase, userId);

  await supabase.from('payment_request_logs').insert({
    payment_request_id: paymentRequestId,
    user_id: userId,
    action: 'revision',
    details: comment ? { comment } : null,
  });

  await appendStageHistory(supabase, paymentRequestId, {
    stage: (currentReq.current_stage as number) ?? 2,
    department: 'omts',
    event: 'revision',
    userEmail: userInfo.email,
    userFullName: userInfo.fullName,
    comment: comment || undefined,
  });

  return { success: true };
}

/** Обработка завершения доработки */
export async function handleCompleteRevision(
  supabase: SupabaseClient,
  paymentRequestId: string,
  userId: string,
  fieldUpdates: {
    deliveryDays: number;
    deliveryDaysType: string;
    shippingConditionId: string;
    invoiceAmount: number;
    supplierId?: string | null;
  },
): Promise<{ success: boolean; error?: string; status?: number }> {
  const { data: cur, error: curErr } = await supabase
    .from('payment_requests')
    .select(
      'status_id, previous_status_id, current_stage, invoice_amount, invoice_amount_history, supplier_id, request_type',
    )
    .eq('id', paymentRequestId)
    .single();
  if (curErr) return { success: false, error: 'Заявка не найдена', status: 404 };
  if (!cur.previous_status_id)
    return { success: false, error: 'Нет предыдущего статуса', status: 400 };

  // Запрет завершения доработки на отклонённой заявке (по коду текущего статуса)
  const { data: curStatus } = await supabase
    .from('statuses')
    .select('code')
    .eq('id', cur.status_id as string)
    .single();
  if (curStatus?.code === 'rejected') {
    return {
      success: false,
      error: 'Нельзя завершить доработку на отклонённой заявке',
      status: 400,
    };
  }

  const { data: prevStatus } = await supabase
    .from('statuses')
    .select('code')
    .eq('id', cur.previous_status_id as string)
    .single();
  // Запрет на восстановление в финальный статус "Отклонено" (защита от испорченного previous_status_id)
  if (prevStatus?.code === 'rejected') {
    return { success: false, error: 'Нельзя вернуть заявку в статус отклонения', status: 400 };
  }
  const wasApproved = prevStatus?.code === 'approved';
  // Возврат уже согласованной contractor-заявки на ПОВТОРНОЕ согласование ОМТС, а не
  // «самовосстановление» в approved (иначе заявка согласуется без нового решения approver'а).
  // Авто-типы (contractor_work/own_purchase) создаются сразу approved без цепочки — им
  // пересогласовывать нечего, сохраняем восстановление approved.
  const reopenOmts = wasApproved && cur.request_type === 'contractor';

  // Финальный шлюз ОМТС: было ли согласование на под-стадии ОМТС-РП (approved is_omts_rp=true)?
  let reopenIsOmtsRp = false;
  if (reopenOmts) {
    const { data: rpApproved } = await supabase
      .from('approval_decisions')
      .select('id')
      .eq('payment_request_id', paymentRequestId)
      .eq('stage_order', 2)
      .eq('department_id', 'omts')
      .eq('status', 'approved')
      .eq('is_omts_rp', true)
      .limit(1);
    reopenIsOmtsRp = ((rpApproved as unknown[]) ?? []).length > 0;
  }

  const updateData: Record<string, unknown> = {
    previous_status_id: null,
    delivery_days: fieldUpdates.deliveryDays,
    delivery_days_type: fieldUpdates.deliveryDaysType,
    shipping_condition_id: fieldUpdates.shippingConditionId,
    invoice_amount: fieldUpdates.invoiceAmount,
    // Заявка возвращается в работу — снимаем флаг отзыва, иначе она выпадет
    // из pending-списков согласования (фильтр withdrawn_at IS NULL)
    withdrawn_at: null,
    withdrawal_comment: null,
  };
  if (reopenOmts) {
    updateData.status_id = await getStatusId(
      supabase,
      'payment_request',
      reopenIsOmtsRp ? 'approv_omts_rp' : 'approv_omts',
    );
    updateData.current_stage = 2;
    updateData.approved_at = null;
    if (!reopenIsOmtsRp) {
      // Возврат в обычное ОМТС: снимаем ОМТС-согласование и перезапускаем «Срок ОМТС».
      updateData.omts_approved_at = null;
      updateData.omts_entered_at = new Date().toISOString();
    }
    // При ОМТС-РП обычное ОМТС уже согласовано ранее — omts_approved_at/omts_entered_at не трогаем.
  } else {
    updateData.status_id = cur.previous_status_id;
    if (wasApproved) updateData.approved_at = new Date().toISOString();
  }
  if (cur.invoice_amount != null && cur.invoice_amount !== fieldUpdates.invoiceAmount) {
    const history = (cur.invoice_amount_history as { amount: number; changedAt: string }[]) ?? [];
    history.push({ amount: cur.invoice_amount as number, changedAt: new Date().toISOString() });
    updateData.invoice_amount_history = history;
  }

  // Смена поставщика: обновляем поле, готовим данные для журнала
  const supplierProvided = fieldUpdates.supplierId !== undefined;
  const newSupplierId = (fieldUpdates.supplierId ?? null) as string | null;
  const oldSupplierId = (cur.supplier_id ?? null) as string | null;
  const supplierChanged = supplierProvided && newSupplierId !== oldSupplierId;
  if (supplierProvided) updateData.supplier_id = newSupplierId;

  const { error: updErr } = await supabase
    .from('payment_requests')
    .update(updateData)
    .eq('id', paymentRequestId);
  if (updErr) return { success: false, error: updErr.message, status: 500 };

  const userInfo = await getUserInfo(supabase, userId);

  // Если поставщик сменился — отдельным логом фиксируем смену с именами/ИНН для читаемости
  if (supplierChanged) {
    const ids = [oldSupplierId, newSupplierId].filter(Boolean) as string[];
    let oldName: string | null = null,
      oldInn: string | null = null,
      newName: string | null = null,
      newInn: string | null = null;
    if (ids.length > 0) {
      const { data: sup } = await supabase.from('suppliers').select('id, name, inn').in('id', ids);
      const map = new Map<string, { name?: string; inn?: string }>();
      (sup ?? []).forEach((s: Record<string, unknown>) =>
        map.set(s.id as string, {
          name: s.name as string | undefined,
          inn: s.inn as string | undefined,
        }),
      );
      if (oldSupplierId) {
        oldName = map.get(oldSupplierId)?.name ?? null;
        oldInn = map.get(oldSupplierId)?.inn ?? null;
      }
      if (newSupplierId) {
        newName = map.get(newSupplierId)?.name ?? null;
        newInn = map.get(newSupplierId)?.inn ?? null;
      }
    }
    await supabase.from('payment_request_logs').insert({
      payment_request_id: paymentRequestId,
      user_id: userId,
      action: 'supplier_changed',
      details: {
        oldSupplierId,
        newSupplierId,
        oldSupplierName: oldName,
        oldSupplierInn: oldInn,
        newSupplierName: newName,
        newSupplierInn: newInn,
      },
    });
  }

  await supabase.from('payment_request_logs').insert({
    payment_request_id: paymentRequestId,
    user_id: userId,
    action: 'revision_complete',
    details: null,
  });
  await appendStageHistory(supabase, paymentRequestId, {
    stage: (cur.current_stage as number) ?? 2,
    department: 'omts',
    event: 'revision_complete',
    userEmail: userInfo.email,
    userFullName: userInfo.fullName,
    ...(supplierChanged ? { supplierChanged: true } : {}),
  });

  // Возврат на повторное согласование: создаём pending-строку ОМТС (очередь строится из
  // approval_decisions), фиксируем «получено». Precheck — идемпотентность от двойного клика.
  if (reopenOmts) {
    const { data: existingPending } = await supabase
      .from('approval_decisions')
      .select('id')
      .eq('payment_request_id', paymentRequestId)
      .eq('status', 'pending')
      .limit(1);
    if (((existingPending as unknown[]) ?? []).length === 0) {
      await supabase.from('approval_decisions').insert({
        payment_request_id: paymentRequestId,
        stage_order: 2,
        department_id: 'omts',
        status: 'pending',
        is_omts_rp: reopenIsOmtsRp,
      });
      await appendStageHistory(supabase, paymentRequestId, {
        stage: 2,
        department: 'omts',
        event: 'received',
        ...(reopenIsOmtsRp ? { isOmtsRp: true } : {}),
      });
    }
  }

  return { success: true };
}

/** Общий select для payment_requests с join-ами */
export const PR_SELECT = `
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

/** Маппинг: разворачивает вложенные join-объекты PR_SELECT в плоскую структуру */
export function flattenPaymentRequest(row: Record<string, unknown>): Record<string, unknown> {
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

/** Маппинг: разворачивает вложенные join-объекты решения по согласованию */
export function flattenApprovalDecision(row: Record<string, unknown>): Record<string, unknown> {
  const user = row.users as Record<string, unknown> | null;
  const flat = { ...row };
  delete flat.users;
  flat.user_email = user?.email ?? null;
  flat.user_full_name = user?.full_name ?? null;
  // Маппинг department_id -> department (фронтенд ожидает поле department)
  if ('department_id' in flat) {
    flat.department = flat.department_id;
    delete flat.department_id;
  }
  return flat;
}
