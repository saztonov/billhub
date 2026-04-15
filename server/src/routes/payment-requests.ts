import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Вспомогательные функции                                            */
/* ------------------------------------------------------------------ */

/** Получить id объектов пользователя */
async function getUserSiteIds(
  supabase: FastifyInstance['supabase'],
  userId: string
): Promise<string[]> {
  const { data } = await supabase
    .from('user_construction_sites_mapping')
    .select('construction_site_id')
    .eq('user_id', userId);
  return (data ?? []).map((s: Record<string, unknown>) => s.construction_site_id as string);
}

/** Получить id статуса по entity_type и code */
async function getStatusId(
  supabase: FastifyInstance['supabase'],
  entityType: string,
  code: string
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
async function appendStageHistory(
  supabase: FastifyInstance['supabase'],
  paymentRequestId: string,
  entry: Record<string, unknown>
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

/** Select-строка для списка заявок */
const PR_LIST_SELECT = `
  *,
  counterparties(name, inn),
  suppliers(name, inn),
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

/** Маппинг: разворачивает вложенные join-объекты Supabase в плоскую структуру для фронтенда */
function flattenPaymentRequest(row: Record<string, unknown>): Record<string, unknown> {
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

  // Удаляем вложенные объекты
  const flat = { ...row };
  delete flat.counterparties;
  delete flat.suppliers;
  delete flat.construction_sites;
  delete flat.statuses;
  delete flat.paid_statuses;
  delete flat.shipping;
  delete flat.cost_types;
  delete flat.current_assignment;

  // Добавляем плоские поля
  flat.counterparty_name = cp?.name ?? null;
  flat.counterparty_inn = cp?.inn ?? null;
  flat.supplier_name = sup?.name ?? null;
  flat.supplier_inn = sup?.inn ?? null;
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

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов                                                   */
/* ------------------------------------------------------------------ */

async function paymentRequestRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticate] };
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /* ---------- GET /api/payment-requests ---------- */
  fastify.get('/api/payment-requests', auth, async (request, reply) => {
    const user = request.user!;
    const query = request.query as Record<string, string | undefined>;
    const supabase = fastify.supabase;

    let q = supabase
      .from('payment_requests')
      .select(PR_LIST_SELECT)
      .order('created_at', { ascending: false });

    // Мягкое удаление
    if (query.showDeleted !== 'true') {
      q = q.eq('is_deleted', false);
    }

    // Изоляция контрагента
    if (user.role === 'counterparty_user' && user.counterpartyId) {
      q = q.eq('counterparty_id', user.counterpartyId);
    } else if (query.counterpartyId) {
      q = q.eq('counterparty_id', query.counterpartyId);
    }

    // Фильтрация по объектам для user без all_sites
    if (user.role === 'user' && !user.allSites) {
      const siteIds = await getUserSiteIds(supabase, user.id);
      if (siteIds.length === 0) return reply.send([]);
      q = q.in('site_id', siteIds);
    }

    // Доп. фильтры
    if (query.supplierId) q = q.eq('supplier_id', query.supplierId);
    if (query.siteId) q = q.eq('site_id', query.siteId);
    if (query.statusId) q = q.eq('status_id', query.statusId);
    if (query.costTypeId) q = q.eq('cost_type_id', query.costTypeId);
    if (query.dateFrom) q = q.gte('created_at', query.dateFrom);
    if (query.dateTo) q = q.lte('created_at', query.dateTo + 'T23:59:59.999Z');
    if (query.search) {
      q = q.or(`request_number.ilike.%${query.search}%`);
    }

    // Пагинация (только если явно указаны параметры)
    if (query.page || query.pageSize) {
      const page = parseInt(query.page ?? '1', 10);
      const pageSize = parseInt(query.pageSize ?? '50', 10);
      const from = (page - 1) * pageSize;
      q = q.range(from, from + pageSize - 1);
    }

    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });

    const mapped = (data ?? []).map((row: Record<string, unknown>) => flattenPaymentRequest(row));
    return reply.send(mapped);
  });

  /* ---------- GET /api/payment-requests/:id ---------- */
  fastify.get('/api/payment-requests/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('payment_requests')
      .select(PR_LIST_SELECT)
      .eq('id', id)
      .single();
    if (error) return reply.status(404).send({ error: 'Заявка не найдена' });

    // Изоляция контрагента
    if (user.role === 'counterparty_user' && user.counterpartyId) {
      if ((data as Record<string, unknown>).counterparty_id !== user.counterpartyId) {
        return reply.status(403).send({ error: 'Доступ запрещён' });
      }
    }

    return reply.send(flattenPaymentRequest(data as Record<string, unknown>));
  });

  /* ---------- POST /api/payment-requests ---------- */
  fastify.post('/api/payment-requests', auth, async (request, reply) => {
    const user = request.user!;
    const body = request.body as {
      siteId: string;
      deliveryDays: number;
      deliveryDaysType: string;
      shippingConditionId: string;
      comment?: string;
      totalFiles: number;
      invoiceAmount?: number;
      supplierId?: string;
    };
    const supabase = fastify.supabase;

    const counterpartyId = user.role === 'counterparty_user'
      ? user.counterpartyId!
      : (request.body as Record<string, unknown>).counterpartyId as string;

    if (!counterpartyId) {
      return reply.status(400).send({ error: 'counterpartyId обязателен' });
    }

    // Статус "Согласование Штаб"
    const statusId = await getStatusId(supabase, 'payment_request', 'approv_shtab');

    // Генерация номера
    const { data: requestNumber, error: numError } = await supabase.rpc('generate_request_number');
    if (numError) return reply.status(500).send({ error: numError.message });

    // Создание заявки
    const { data: created, error: reqError } = await supabase
      .from('payment_requests')
      .insert({
        request_number: requestNumber,
        counterparty_id: counterpartyId,
        site_id: body.siteId,
        status_id: statusId,
        delivery_days: body.deliveryDays,
        delivery_days_type: body.deliveryDaysType,
        shipping_condition_id: body.shippingConditionId,
        comment: body.comment || null,
        invoice_amount: body.invoiceAmount || null,
        supplier_id: body.supplierId || null,
        total_files: body.totalFiles,
        uploaded_files: 0,
        created_by: user.id,
      })
      .select('id')
      .single();
    if (reqError) return reply.status(500).send({ error: reqError.message });

    // Первый этап согласования — Штаб
    await supabase.from('approval_decisions').insert({
      payment_request_id: created.id,
      stage_order: 1,
      department_id: 'shtab',
      status: 'pending',
    });

    await appendStageHistory(supabase, created.id as string, {
      stage: 1, department: 'shtab', event: 'received',
    });

    await supabase
      .from('payment_requests')
      .update({ current_stage: 1 })
      .eq('id', created.id);

    return reply.status(201).send({ requestId: created.id, requestNumber });
  });

  /* ---------- PUT /api/payment-requests/:id ---------- */
  fastify.put('/api/payment-requests/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = request.body as Record<string, unknown>;
    const supabase = fastify.supabase;

    // Получаем текущие значения (в т.ч. историю сумм — при amount_change пополняем её)
    const { data: current, error: fetchErr } = await supabase
      .from('payment_requests')
      .select('delivery_days, delivery_days_type, shipping_condition_id, site_id, comment, invoice_amount, invoice_amount_history, total_files, supplier_id, counterparty_id')
      .eq('id', id)
      .single();
    if (fetchErr) return reply.status(404).send({ error: 'Заявка не найдена' });

    // Изоляция контрагента
    if (user.role === 'counterparty_user' && user.counterpartyId) {
      if (current.counterparty_id !== user.counterpartyId) {
        return reply.status(403).send({ error: 'Доступ запрещён' });
      }
    }

    const updates: Record<string, unknown> = {};
    const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];

    const cur = current as Record<string, unknown>;
    const fieldMap: Record<string, string> = {
      deliveryDays: 'delivery_days',
      deliveryDaysType: 'delivery_days_type',
      shippingConditionId: 'shipping_condition_id',
      siteId: 'site_id',
      comment: 'comment',
      invoiceAmount: 'invoice_amount',
      supplierId: 'supplier_id',
    };

    for (const [camel, snake] of Object.entries(fieldMap)) {
      if (body[camel] !== undefined && body[camel] !== cur[snake]) {
        updates[snake] = body[camel] ?? null;
        changes.push({ field: snake, oldValue: cur[snake], newValue: body[camel] ?? null });
      }
    }

    // Если сумма счёта изменилась и причина — фактическое изменение суммы счёта,
    // старое значение пушим в invoice_amount_history (в том же формате, что и при resubmit)
    const invoiceAmountReason = body.invoiceAmountReason as 'error' | 'amount_change' | undefined;
    if (
      updates.invoice_amount !== undefined &&
      invoiceAmountReason === 'amount_change' &&
      cur.invoice_amount != null
    ) {
      const history = (cur.invoice_amount_history as { amount: number; changedAt: string }[]) ?? [];
      history.push({ amount: cur.invoice_amount as number, changedAt: new Date().toISOString() });
      updates.invoice_amount_history = history;
    }

    const newFilesCount = body.newFilesCount as number | undefined;
    if (newFilesCount && newFilesCount > 0) {
      updates.total_files = ((cur.total_files as number) ?? 0) + newFilesCount;
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('payment_requests').update(updates).eq('id', id);
      if (error) return reply.status(500).send({ error: error.message });
    }

    // Логируем изменения
    if (changes.length > 0) {
      const details: Record<string, unknown> = { changes };
      if (invoiceAmountReason && updates.invoice_amount !== undefined) {
        details.invoiceAmountReason = invoiceAmountReason;
      }
      await supabase.from('payment_request_logs').insert({
        payment_request_id: id,
        user_id: user.id,
        action: 'edit',
        details,
      });
    }

    return reply.send({ success: true });
  });

  /* ---------- DELETE /api/payment-requests/:id ---------- */
  fastify.delete('/api/payment-requests/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('payment_requests')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- POST /api/payment-requests/:id/withdraw ---------- */
  fastify.post('/api/payment-requests/:id/withdraw', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { comment?: string };
    const supabase = fastify.supabase;

    const statusId = await getStatusId(supabase, 'payment_request', 'withdrawn');

    const { error } = await supabase
      .from('payment_requests')
      .update({
        status_id: statusId,
        withdrawn_at: new Date().toISOString(),
        withdrawal_comment: body.comment || null,
      })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- POST /api/payment-requests/:id/resubmit ---------- */
  fastify.post('/api/payment-requests/:id/resubmit', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = request.body as {
      comment: string;
      fileCount?: number;
      fieldUpdates?: {
        deliveryDays: number;
        deliveryDaysType: string;
        shippingConditionId: string;
        invoiceAmount: number;
      };
    };
    const supabase = fastify.supabase;

    // Статус "Согласование Штаб"
    const statusId = await getStatusId(supabase, 'payment_request', 'approv_shtab');

    // Текущие данные
    const { data: cur, error: curErr } = await supabase
      .from('payment_requests')
      .select('resubmit_count, rejected_stage, site_id, invoice_amount, invoice_amount_history')
      .eq('id', id)
      .single();
    if (curErr) return reply.status(404).send({ error: 'Заявка не найдена' });

    const newCount = ((cur.resubmit_count as number) ?? 0) + 1;
    const updateData: Record<string, unknown> = {
      status_id: statusId,
      rejected_at: null,
      rejected_stage: null,
      approved_at: null,
      current_stage: 1,
      resubmit_comment: body.comment || null,
      resubmit_count: newCount,
    };

    if (body.fieldUpdates) {
      const history = (cur.invoice_amount_history as { amount: number; changedAt: string }[]) ?? [];
      if (cur.invoice_amount != null) {
        history.push({ amount: cur.invoice_amount as number, changedAt: new Date().toISOString() });
      }
      updateData.invoice_amount_history = history;
      updateData.delivery_days = body.fieldUpdates.deliveryDays;
      updateData.delivery_days_type = body.fieldUpdates.deliveryDaysType;
      updateData.shipping_condition_id = body.fieldUpdates.shippingConditionId;
      updateData.invoice_amount = body.fieldUpdates.invoiceAmount;
    }

    const { error: updErr } = await supabase.from('payment_requests').update(updateData).eq('id', id);
    if (updErr) return reply.status(500).send({ error: updErr.message });

    // Удаляем pending-записи Штаба и создаём новую
    await supabase
      .from('approval_decisions')
      .delete()
      .eq('payment_request_id', id)
      .eq('stage_order', 1)
      .eq('department_id', 'shtab')
      .eq('status', 'pending');

    await supabase.from('approval_decisions').insert({
      payment_request_id: id,
      stage_order: 1,
      department_id: 'shtab',
      status: 'pending',
    });

    await appendStageHistory(supabase, id, { stage: 1, department: 'shtab', event: 'received' });

    // Лог повторной отправки
    await supabase.from('payment_request_logs').insert({
      payment_request_id: id,
      user_id: user.id,
      action: 'resubmit',
      details: {
        comment: body.comment,
        fileCount: body.fileCount ?? 0,
        target_stage: 1,
        target_department: 'shtab',
        resubmit_count: newCount,
      },
    });

    return reply.send({ success: true });
  });

  /* ---------- GET /api/payment-requests/:id/files ---------- */
  fastify.get('/api/payment-requests/:id/files', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('payment_request_files')
      .select('*, document_types(name), users!payment_request_files_created_by_fkey(role, department_id, counterparties(name))')
      .eq('payment_request_id', id)
      .order('created_at', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });

    /** Преобразуем вложенные join-объекты в плоские поля */
    const files = (data ?? []).map((row: Record<string, unknown>) => {
      const docType = row.document_types as { name: string } | null;
      const uploader = row.users as { role: string; department_id: string | null; counterparties: { name: string } | null } | null;

      return {
        ...row,
        document_type_name: docType?.name ?? null,
        uploader_role: uploader?.role ?? null,
        uploader_department: uploader?.department_id ?? null,
        uploader_counterparty_name: uploader?.counterparties?.name ?? null,
        document_types: undefined,
        users: undefined,
      };
    });

    return reply.send(files);
  });

  /* ---------- POST /api/payment-requests/:id/toggle-file-rejection ---------- */
  fastify.post('/api/payment-requests/:id/toggle-file-rejection', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const body = request.body as { fileId: string };
    const supabase = fastify.supabase;

    const { data: file, error: fetchErr } = await supabase
      .from('payment_request_files')
      .select('id, is_rejected')
      .eq('id', body.fileId)
      .single();
    if (fetchErr) return reply.status(404).send({ error: 'Файл не найден' });

    const newRejected = !(file.is_rejected as boolean);
    const updateData = newRejected
      ? { is_rejected: true, rejected_by: user.id, rejected_at: new Date().toISOString() }
      : { is_rejected: false, rejected_by: null, rejected_at: null };

    const { error } = await supabase
      .from('payment_request_files')
      .update(updateData)
      .eq('id', body.fileId);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true, isRejected: newRejected });
  });

  /* ---------- PUT /api/payment-requests/:id/dp-data ---------- */
  fastify.put('/api/payment-requests/:id/dp-data', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      dpNumber: string;
      dpDate: string;
      dpAmount: number;
      dpFileKey: string;
      dpFileName: string;
    };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('payment_requests')
      .update({
        dp_number: body.dpNumber,
        dp_date: body.dpDate,
        dp_amount: body.dpAmount,
        dp_file_key: body.dpFileKey,
        dp_file_name: body.dpFileName,
      })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });
}

export default paymentRequestRoutes;
