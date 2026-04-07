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

/** Добавить запись в status_history заявки на договор */
async function appendContractStatusHistory(
  supabase: FastifyInstance['supabase'],
  contractRequestId: string,
  entry: Record<string, unknown>,
  userId: string
): Promise<void> {
  const { data: userData } = await supabase
    .from('users')
    .select('full_name, email')
    .eq('id', userId)
    .single();

  const { data: current } = await supabase
    .from('contract_requests')
    .select('status_history')
    .eq('id', contractRequestId)
    .single();

  const history = (current?.status_history as Record<string, unknown>[]) ?? [];
  history.push({
    ...entry,
    at: new Date().toISOString(),
    userFullName: userData?.full_name ?? undefined,
    userEmail: userData?.email ?? undefined,
  });

  await supabase
    .from('contract_requests')
    .update({ status_history: history })
    .eq('id', contractRequestId);
}

/** Select-строка для списка заявок на договор */
const CR_LIST_SELECT = `
  id, request_number, site_id, counterparty_id, supplier_id,
  parties_count, subject_type, subject_detail, status_id,
  revision_targets, created_by, created_at,
  is_deleted, deleted_at, original_received_at, status_history,
  responsible_user_id, contract_number, contract_signing_date,
  counterparties(name, inn),
  suppliers(name, inn),
  construction_sites(name),
  statuses!contract_requests_status_id_fkey(name, color, code),
  creator:users!contract_requests_created_by_fkey(full_name),
  responsible:users!contract_requests_responsible_user_id_fkey(full_name)
`;

/** Маппинг: разворачивает вложенные join-объекты заявки на договор в плоскую структуру */
function flattenContractRequest(row: Record<string, unknown>): Record<string, unknown> {
  const cp = row.counterparties as Record<string, unknown> | null;
  const sup = row.suppliers as Record<string, unknown> | null;
  const site = row.construction_sites as Record<string, unknown> | null;
  const status = row.statuses as Record<string, unknown> | null;
  const creator = row.creator as Record<string, unknown> | null;
  const responsible = row.responsible as Record<string, unknown> | null;
  const flat = { ...row };
  delete flat.counterparties;
  delete flat.suppliers;
  delete flat.construction_sites;
  delete flat.statuses;
  delete flat.creator;
  delete flat.responsible;
  flat.counterparty_name = cp?.name ?? null;
  flat.counterparty_inn = cp?.inn ?? null;
  flat.supplier_name = sup?.name ?? null;
  flat.supplier_inn = sup?.inn ?? null;
  flat.site_name = site?.name ?? null;
  flat.status_name = status?.name ?? null;
  flat.status_color = status?.color ?? null;
  flat.status_code = status?.code ?? null;
  flat.creator_full_name = creator?.full_name ?? null;
  flat.responsible_user_full_name = responsible?.full_name ?? null;
  return flat;
}

/** Маппинг: разворачивает вложенные join-объекты файла заявки на договор */
function flattenContractRequestFile(row: Record<string, unknown>): Record<string, unknown> {
  const user = row.users as Record<string, unknown> | null;
  const counterparty = user?.counterparties as Record<string, unknown> | null;
  const flat = { ...row };
  delete flat.users;
  flat.uploader_role = user?.role ?? null;
  flat.uploader_department = user?.department_id ?? null;
  flat.uploader_counterparty_name = counterparty?.name ?? null;
  return flat;
}

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов                                                   */
/* ------------------------------------------------------------------ */

async function contractRequestRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticate] };
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /* ---------- GET /api/contract-requests ---------- */
  fastify.get('/api/contract-requests', auth, async (request, reply) => {
    const user = request.user!;
    const query = request.query as Record<string, string | undefined>;
    const supabase = fastify.supabase;

    let q = supabase
      .from('contract_requests')
      .select(CR_LIST_SELECT)
      .order('created_at', { ascending: false });

    if (query.showDeleted !== 'true') {
      q = q.eq('is_deleted', false);
    }

    // Изоляция контрагента
    if (user.role === 'counterparty_user' && user.counterpartyId) {
      q = q.eq('counterparty_id', user.counterpartyId);
    } else if (query.counterpartyId) {
      q = q.eq('counterparty_id', query.counterpartyId);
    }

    // Фильтрация по объектам
    if (user.role === 'user' && !user.allSites) {
      const siteIds = await getUserSiteIds(supabase, user.id);
      if (siteIds.length === 0) return reply.send([]);
      q = q.in('site_id', siteIds);
    }

    if (query.supplierId) q = q.eq('supplier_id', query.supplierId);
    if (query.siteId) q = q.eq('site_id', query.siteId);
    if (query.statusId) q = q.eq('status_id', query.statusId);

    // Пагинация
    const page = parseInt(query.page ?? '1', 10);
    const pageSize = parseInt(query.pageSize ?? '50', 10);
    const from = (page - 1) * pageSize;
    q = q.range(from, from + pageSize - 1);

    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send((data ?? []).map((r: Record<string, unknown>) => flattenContractRequest(r)));
  });

  /* ---------- GET /api/contract-requests/:id ---------- */
  fastify.get('/api/contract-requests/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('contract_requests')
      .select(CR_LIST_SELECT)
      .eq('id', id)
      .single();
    if (error) return reply.status(404).send({ error: 'Заявка не найдена' });

    if (user.role === 'counterparty_user' && user.counterpartyId) {
      if ((data as Record<string, unknown>).counterparty_id !== user.counterpartyId) {
        return reply.status(403).send({ error: 'Доступ запрещён' });
      }
    }

    return reply.send(flattenContractRequest(data as Record<string, unknown>));
  });

  /* ---------- POST /api/contract-requests ---------- */
  fastify.post('/api/contract-requests', auth, async (request, reply) => {
    const user = request.user!;
    const body = request.body as {
      siteId: string;
      counterpartyId: string;
      supplierId: string;
      partiesCount: number;
      subjectType: string;
      subjectDetail?: string;
      totalFiles: number;
    };
    const supabase = fastify.supabase;

    const statusId = await getStatusId(supabase, 'contract_request', 'approv_omts');

    const { data: requestNumber, error: numError } = await supabase.rpc('generate_contract_request_number');
    if (numError) return reply.status(500).send({ error: numError.message });

    const { data: created, error: reqError } = await supabase
      .from('contract_requests')
      .insert({
        request_number: requestNumber,
        site_id: body.siteId,
        counterparty_id: body.counterpartyId,
        supplier_id: body.supplierId,
        parties_count: body.partiesCount,
        subject_type: body.subjectType,
        subject_detail: body.subjectDetail || null,
        status_id: statusId,
        created_by: user.id,
      })
      .select('id')
      .single();
    if (reqError) return reply.status(500).send({ error: reqError.message });

    await appendContractStatusHistory(supabase, created.id as string, { event: 'created' }, user.id);

    return reply.status(201).send({ requestId: created.id, requestNumber });
  });

  /* ---------- PUT /api/contract-requests/:id ---------- */
  fastify.put('/api/contract-requests/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const supabase = fastify.supabase;

    const updateData: Record<string, unknown> = {};
    const fieldMap: Record<string, string> = {
      siteId: 'site_id',
      counterpartyId: 'counterparty_id',
      supplierId: 'supplier_id',
      partiesCount: 'parties_count',
      subjectType: 'subject_type',
      subjectDetail: 'subject_detail',
    };

    for (const [camel, snake] of Object.entries(fieldMap)) {
      if (body[camel] !== undefined) updateData[snake] = body[camel];
    }

    if (Object.keys(updateData).length === 0) {
      return reply.send({ success: true });
    }

    const { error } = await supabase.from('contract_requests').update(updateData).eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- DELETE /api/contract-requests/:id ---------- */
  fastify.delete('/api/contract-requests/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('contract_requests')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- POST /api/contract-requests/:id/files ---------- */
  /** Сохранить метаданные файла заявки на договор (вызывается из uploadQueueStore) */
  fastify.post('/api/contract-requests/:id/files', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      fileName: string;
      fileKey: string;
      fileSize: number;
      mimeType: string | null;
      userId: string;
      isAdditional: boolean;
      isSignedContract?: boolean;
    };
    const supabase = fastify.supabase;

    // Флаг "Подписанный договор" разрешён только на статусах approved_waiting и concluded
    let isSignedContract = false;
    if (body.isSignedContract) {
      const { data: cr } = await supabase
        .from('contract_requests')
        .select('status_id, statuses!contract_requests_status_id_fkey(code)')
        .eq('id', id)
        .single();
      const code = (cr?.statuses as { code?: string } | null)?.code;
      if (code === 'approved_waiting' || code === 'concluded') {
        isSignedContract = true;
      }
    }

    const { error } = await supabase
      .from('contract_request_files')
      .insert({
        contract_request_id: id,
        file_name: body.fileName,
        file_key: body.fileKey,
        file_size: body.fileSize,
        mime_type: body.mimeType,
        created_by: body.userId,
        is_additional: body.isAdditional ?? false,
        is_signed_contract: isSignedContract,
      });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.status(201).send({ success: true });
  });

  /* ---------- PATCH /api/contract-requests/files/:fileId/rejection ---------- */
  /** Переключить отклонение файла заявки на договор (по fileId в URL) */
  fastify.patch('/api/contract-requests/files/:fileId/rejection', adminOrUser, async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    const body = request.body as { isRejected: boolean; userId: string };
    const supabase = fastify.supabase;

    const updateData = body.isRejected
      ? { is_rejected: true, rejected_by: body.userId, rejected_at: new Date().toISOString() }
      : { is_rejected: false, rejected_by: null, rejected_at: null };

    const { error } = await supabase
      .from('contract_request_files')
      .update(updateData)
      .eq('id', fileId);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true, isRejected: body.isRejected });
  });

  /* ---------- POST /api/contract-requests/:id/revision ---------- */
  /** Отправить на доработку (алиас для send-to-revision) */
  fastify.post('/api/contract-requests/:id/revision', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = request.body as { targets: string[] };
    const supabase = fastify.supabase;

    const statusId = await getStatusId(supabase, 'contract_request', 'on_revision');

    const { error } = await supabase
      .from('contract_requests')
      .update({ status_id: statusId, revision_targets: body.targets })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    await appendContractStatusHistory(supabase, id, {
      event: 'revision', revisionTargets: body.targets,
    }, user.id);

    return reply.send({ success: true });
  });

  /* ---------- POST /api/contract-requests/:id/revision-complete ---------- */
  /** Завершить доработку (алиас для complete-revision) */
  fastify.post('/api/contract-requests/:id/revision-complete', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = request.body as { target: string };
    const supabase = fastify.supabase;

    const { data: current, error: fetchErr } = await supabase
      .from('contract_requests')
      .select('revision_targets')
      .eq('id', id)
      .single();
    if (fetchErr) return reply.status(404).send({ error: 'Заявка не найдена' });

    const currentTargets = (current.revision_targets as string[]) ?? [];
    const newTargets = currentTargets.filter((t) => t !== body.target);

    if (newTargets.length === 0) {
      const statusId = await getStatusId(supabase, 'contract_request', 'approv_omts');
      const { error } = await supabase
        .from('contract_requests')
        .update({ status_id: statusId, revision_targets: [] })
        .eq('id', id);
      if (error) return reply.status(500).send({ error: error.message });
    } else {
      const { error } = await supabase
        .from('contract_requests')
        .update({ revision_targets: newTargets })
        .eq('id', id);
      if (error) return reply.status(500).send({ error: error.message });
    }

    await appendContractStatusHistory(supabase, id, {
      event: 'revision_complete', revisionTarget: body.target,
    }, user.id);

    return reply.send({ success: true });
  });

  /* ---------- POST /api/contract-requests/:id/original-received ---------- */
  /** Подтвердить получение оригинала (алиас для mark-original-received) */
  fastify.post('/api/contract-requests/:id/original-received', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const supabase = fastify.supabase;

    const statusId = await getStatusId(supabase, 'contract_request', 'concluded');

    const { error } = await supabase
      .from('contract_requests')
      .update({ status_id: statusId, original_received_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    await appendContractStatusHistory(supabase, id, { event: 'original_received' }, user.id);

    return reply.send({ success: true });
  });

  /* ---------- POST /api/contract-requests/:id/send-to-revision ---------- */
  fastify.post('/api/contract-requests/:id/send-to-revision', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = request.body as { targets: string[] };
    const supabase = fastify.supabase;

    const statusId = await getStatusId(supabase, 'contract_request', 'on_revision');

    const { error } = await supabase
      .from('contract_requests')
      .update({ status_id: statusId, revision_targets: body.targets })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    await appendContractStatusHistory(supabase, id, {
      event: 'revision', revisionTargets: body.targets,
    }, user.id);

    return reply.send({ success: true });
  });

  /* ---------- POST /api/contract-requests/:id/complete-revision ---------- */
  fastify.post('/api/contract-requests/:id/complete-revision', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = request.body as { target: string };
    const supabase = fastify.supabase;

    const { data: current, error: fetchErr } = await supabase
      .from('contract_requests')
      .select('revision_targets')
      .eq('id', id)
      .single();
    if (fetchErr) return reply.status(404).send({ error: 'Заявка не найдена' });

    const currentTargets = (current.revision_targets as string[]) ?? [];
    const newTargets = currentTargets.filter((t) => t !== body.target);

    if (newTargets.length === 0) {
      // Все доработки завершены — возвращаем в "Согласование ОМТС"
      const statusId = await getStatusId(supabase, 'contract_request', 'approv_omts');
      const { error } = await supabase
        .from('contract_requests')
        .update({ status_id: statusId, revision_targets: [] })
        .eq('id', id);
      if (error) return reply.status(500).send({ error: error.message });
    } else {
      const { error } = await supabase
        .from('contract_requests')
        .update({ revision_targets: newTargets })
        .eq('id', id);
      if (error) return reply.status(500).send({ error: error.message });
    }

    await appendContractStatusHistory(supabase, id, {
      event: 'revision_complete', revisionTarget: body.target,
    }, user.id);

    return reply.send({ success: true });
  });

  /* ---------- POST /api/contract-requests/:id/approve ---------- */
  fastify.post('/api/contract-requests/:id/approve', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const supabase = fastify.supabase;

    const statusId = await getStatusId(supabase, 'contract_request', 'approved_waiting');

    const { error } = await supabase
      .from('contract_requests')
      .update({ status_id: statusId, revision_targets: [] })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    await appendContractStatusHistory(supabase, id, { event: 'approved' }, user.id);

    return reply.send({ success: true });
  });

  /* ---------- POST /api/contract-requests/:id/mark-original-received ---------- */
  fastify.post('/api/contract-requests/:id/mark-original-received', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const supabase = fastify.supabase;

    const statusId = await getStatusId(supabase, 'contract_request', 'concluded');

    const { error } = await supabase
      .from('contract_requests')
      .update({ status_id: statusId, original_received_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    await appendContractStatusHistory(supabase, id, { event: 'original_received' }, user.id);

    return reply.send({ success: true });
  });

  /* ---------- POST /api/contract-requests/:id/revert-to-waiting ---------- */
  /** Откат статуса "Заключен" -> "Согласовано, ожидание оригинала" (ОМТС/admin) */
  fastify.post('/api/contract-requests/:id/revert-to-waiting', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = (request.body ?? {}) as { comment?: string | null };
    const supabase = fastify.supabase;

    // Проверка прав: только ОМТС или admin
    if (user.role !== 'admin' && user.department !== 'omts') {
      return reply.status(403).send({ error: 'Недостаточно прав' });
    }

    // Проверка текущего статуса — должен быть concluded
    const { data: current, error: fetchErr } = await supabase
      .from('contract_requests')
      .select('status_id, statuses!contract_requests_status_id_fkey(code)')
      .eq('id', id)
      .single();
    if (fetchErr) return reply.status(404).send({ error: 'Заявка не найдена' });
    const currentCode = (current?.statuses as { code?: string } | null)?.code;
    if (currentCode !== 'concluded') {
      return reply.status(400).send({ error: 'Смена статуса доступна только для заявок со статусом "Заключен"' });
    }

    const statusId = await getStatusId(supabase, 'contract_request', 'approved_waiting');

    const { error } = await supabase
      .from('contract_requests')
      .update({ status_id: statusId, original_received_at: null })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    const comment = body.comment?.trim() || null;
    await appendContractStatusHistory(
      supabase,
      id,
      { event: 'reverted_to_waiting', ...(comment ? { comment } : {}) },
      user.id,
    );

    return reply.send({ success: true });
  });

  /* ---------- GET /api/contract-requests/:id/files ---------- */
  fastify.get('/api/contract-requests/:id/files', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('contract_request_files')
      .select('id, contract_request_id, file_name, file_key, file_size, mime_type, created_by, created_at, is_additional, is_rejected, rejected_by, rejected_at, is_signed_contract, users!contract_request_files_created_by_fkey(role, department_id, counterparties(name))')
      .eq('contract_request_id', id)
      .order('created_at', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send((data ?? []).map((r: Record<string, unknown>) => flattenContractRequestFile(r)));
  });

  /* ---------- POST /api/contract-requests/:id/assign ---------- */
  /** Взять заявку в работу (назначить текущего пользователя ответственным) */
  fastify.post('/api/contract-requests/:id/assign', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('contract_requests')
      .update({ responsible_user_id: user.id })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    await appendContractStatusHistory(supabase, id, { event: 'assigned' }, user.id);

    return reply.send({ success: true });
  });

  /* ---------- PATCH /api/contract-requests/:id/contract-details ---------- */
  /** Обновить номер договора и/или дату подписания */
  fastify.patch('/api/contract-requests/:id/contract-details', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      contractNumber?: string | null;
      contractSigningDate?: string | null;
    };
    const supabase = fastify.supabase;

    const updateData: Record<string, unknown> = {};
    if (body.contractNumber !== undefined) updateData.contract_number = body.contractNumber;
    if (body.contractSigningDate !== undefined) updateData.contract_signing_date = body.contractSigningDate;

    if (Object.keys(updateData).length === 0) {
      return reply.send({ success: true });
    }

    const { error } = await supabase
      .from('contract_requests')
      .update(updateData)
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- POST /api/contract-requests/:id/toggle-file-rejection ---------- */
  fastify.post('/api/contract-requests/:id/toggle-file-rejection', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const body = request.body as { fileId: string };
    const supabase = fastify.supabase;

    const { data: file, error: fetchErr } = await supabase
      .from('contract_request_files')
      .select('id, is_rejected')
      .eq('id', body.fileId)
      .single();
    if (fetchErr) return reply.status(404).send({ error: 'Файл не найден' });

    const newRejected = !(file.is_rejected as boolean);
    const updateData = newRejected
      ? { is_rejected: true, rejected_by: user.id, rejected_at: new Date().toISOString() }
      : { is_rejected: false, rejected_by: null, rejected_at: null };

    const { error } = await supabase
      .from('contract_request_files')
      .update(updateData)
      .eq('id', body.fileId);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true, isRejected: newRejected });
  });

  /* ---------- PATCH /api/contract-requests/files/:fileId/signed-contract ---------- */
  /** Установить/снять флаг "Подписанный договор" у файла */
  fastify.patch('/api/contract-requests/files/:fileId/signed-contract', adminOrUser, async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    const body = request.body as { isSignedContract: boolean };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('contract_request_files')
      .update({ is_signed_contract: !!body.isSignedContract })
      .eq('id', fileId);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true, isSignedContract: !!body.isSignedContract });
  });
}

export default contractRequestRoutes;
