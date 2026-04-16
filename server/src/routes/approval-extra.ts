import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  appendStageHistory,
  getUserSiteIds,
  handleSendToRevision,
  handleCompleteRevision,
  PR_SELECT,
  flattenPaymentRequest,
} from './approval-helpers.js';

/* ------------------------------------------------------------------ */
/*  Дополнительные маршруты согласований                                */
/* ------------------------------------------------------------------ */

async function approvalExtraRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /* ---------- POST /api/approvals/payment-request/:paymentRequestId/stage-history ---------- */
  /* Добавление записи в stage_history заявки */
  fastify.post('/api/approvals/payment-request/:paymentRequestId/stage-history', adminOrUser, async (request, reply) => {
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    const entry = request.body as Record<string, unknown>;

    await appendStageHistory(fastify.supabase, paymentRequestId, entry);
    return reply.send({ success: true });
  });

  /* ---------- POST /api/approvals/payment-request/:paymentRequestId/revision ---------- */
  /* Отправка заявки на доработку (альтернативный путь) */
  fastify.post('/api/approvals/payment-request/:paymentRequestId/revision', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    const body = request.body as { comment: string };

    const result = await handleSendToRevision(fastify.supabase, paymentRequestId, user.id, body.comment);
    if (!result.success) return reply.status(result.status ?? 500).send({ error: result.error });
    return reply.send({ success: true });
  });

  /* ---------- POST /api/approvals/payment-request/:paymentRequestId/revision-complete ---------- */
  /* Завершение доработки (альтернативный путь) */
  fastify.post('/api/approvals/payment-request/:paymentRequestId/revision-complete', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user!;
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    const body = request.body as {
      deliveryDays: number;
      deliveryDaysType: string;
      shippingConditionId: string;
      invoiceAmount: number;
      supplierId?: string | null;
    };

    const result = await handleCompleteRevision(fastify.supabase, paymentRequestId, user.id, body);
    if (!result.success) return reply.status(result.status ?? 500).send({ error: result.error });
    return reply.send({ success: true });
  });

  /* ---------- POST /api/approvals/create-decision ---------- */
  /* Создание решения по согласованию (алиас для /api/approvals/decide) */
  fastify.post('/api/approvals/create-decision', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const body = request.body as {
      paymentRequestId: string;
      department: string;
      action: 'approve' | 'reject';
      comment: string;
    };
    const supabase = fastify.supabase;

    const { data: pr, error: prError } = await supabase
      .from('payment_requests')
      .select('current_stage, site_id, withdrawn_at')
      .eq('id', body.paymentRequestId)
      .single();
    if (prError) return reply.status(404).send({ error: 'Заявка не найдена' });
    if (pr.withdrawn_at) return reply.status(400).send({ error: 'Невозможно обработать отозванную заявку' });

    const currentStage = pr.current_stage as number;

    // Создаём решение в таблице
    const { data: decision, error: decErr } = await supabase
      .from('approval_decisions')
      .update({
        status: body.action === 'approve' ? 'approved' : 'rejected',
        user_id: user.id,
        comment: body.comment,
        decided_at: new Date().toISOString(),
      })
      .eq('payment_request_id', body.paymentRequestId)
      .eq('stage_order', currentStage)
      .eq('department_id', body.department)
      .eq('status', 'pending')
      .select('id')
      .single();
    if (decErr) return reply.status(404).send({ error: 'Решение не найдено' });

    return reply.send({ success: true, decisionId: decision.id });
  });

  /* ---------- POST /api/approvals/decisions/:decisionId/files ---------- */
  /* Создание файла для решения (используется uploadQueueStore) */
  fastify.post('/api/approvals/decisions/:decisionId/files', adminOrUser, async (request, reply) => {
    const { decisionId } = request.params as { decisionId: string };
    const body = request.body as {
      fileName: string;
      fileKey: string;
      fileSize: number | null;
      mimeType: string | null;
      userId: string;
    };

    const { data, error } = await fastify.supabase
      .from('approval_decision_files')
      .insert({
        approval_decision_id: decisionId,
        file_name: body.fileName,
        file_key: body.fileKey,
        file_size: body.fileSize,
        mime_type: body.mimeType,
        created_by: body.userId,
      })
      .select('id')
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send({ data });
  });

  /* ---------- GET /api/approvals/approved-requests ---------- */
  /* Список согласованных заявок (возвращает массив напрямую) */
  fastify.get('/api/approvals/approved-requests', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;
    const query = request.query as { allSites?: string; siteIds?: string };

    const allSites = query.allSites === 'true' || user.role === 'admin';
    const siteIds = query.siteIds ? query.siteIds.split(',') : [];

    if (!allSites && siteIds.length === 0) return reply.send([]);

    let q = supabase.from('payment_requests').select(PR_SELECT)
      .not('approved_at', 'is', null).eq('is_deleted', false)
      .order('approved_at', { ascending: false });
    if (!allSites) q = q.in('site_id', siteIds);

    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send((data ?? []).map((r: Record<string, unknown>) => flattenPaymentRequest(r)));
  });

  /* ---------- GET /api/approvals/rejected-requests ---------- */
  /* Список отклонённых заявок (возвращает массив напрямую) */
  fastify.get('/api/approvals/rejected-requests', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;
    const query = request.query as { allSites?: string; siteIds?: string };

    const allSites = query.allSites === 'true' || user.role === 'admin';
    const siteIds = query.siteIds ? query.siteIds.split(',') : [];

    if (!allSites && siteIds.length === 0) return reply.send([]);

    let q = supabase.from('payment_requests').select(PR_SELECT)
      .not('rejected_at', 'is', null).eq('is_deleted', false)
      .order('rejected_at', { ascending: false });
    if (!allSites) q = q.in('site_id', siteIds);

    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send((data ?? []).map((r: Record<string, unknown>) => flattenPaymentRequest(r)));
  });

  /* ---------- GET /api/approvals/pending-count ---------- */
  /* Количество заявок на согласовании */
  fastify.get('/api/approvals/pending-count', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;
    const query = request.query as { department?: string; userId?: string; isAdmin?: string };

    const department = query.department;
    const isAdmin = query.isAdmin === 'true' || user.role === 'admin';

    if (!department) return reply.send({ count: 0 });

    const { allSites, siteIds: userSiteIds } = await getUserSiteIds(supabase, user.id);

    let decisionsQuery = supabase
      .from('approval_decisions').select('payment_request_id')
      .eq('department_id', department).eq('status', 'pending');

    if (department === 'omts' && !isAdmin) {
      const { data: rpConfig } = await supabase.from('settings').select('value').eq('key', 'omts_rp_config').single();
      const rpResponsibleId = (rpConfig?.value as Record<string, unknown>)?.responsible_user_id as string | null;
      if (user.id !== rpResponsibleId) decisionsQuery = decisionsQuery.eq('is_omts_rp', false);
    }

    const { data: decisions, error: decErr } = await decisionsQuery;
    if (decErr) return reply.status(500).send({ error: decErr.message });

    const requestIds = [...new Set((decisions ?? []).map((d: Record<string, unknown>) => d.payment_request_id as string))];
    if (requestIds.length === 0 || (!allSites && userSiteIds.length === 0)) return reply.send({ count: 0 });

    let prQuery = supabase.from('payment_requests').select('id', { count: 'exact', head: true })
      .in('id', requestIds).eq('is_deleted', false).is('withdrawn_at', null);
    if (!allSites) prQuery = prQuery.in('site_id', userSiteIds);

    const { count, error } = await prQuery;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ count: count ?? 0 });
  });

  /* ---------- GET /api/approvals/all-count ---------- */
  /* Количество всех не удалённых заявок */
  fastify.get('/api/approvals/all-count', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;
    const query = request.query as { allSites?: string; siteIds?: string };

    const allSites = query.allSites === 'true' || user.role === 'admin';
    const siteIds = query.siteIds ? query.siteIds.split(',') : [];

    if (!allSites && siteIds.length === 0) return reply.send({ count: 0 });

    let q = supabase.from('payment_requests').select('id', { count: 'exact', head: true })
      .eq('is_deleted', false);
    if (!allSites) q = q.in('site_id', siteIds);

    const { count, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ count: count ?? 0 });
  });

  /* ---------- GET /api/approvals/specialists-count ---------- */
  /* Количество заявок без назначенного специалиста */
  fastify.get('/api/approvals/specialists-count', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;
    const { allSites, siteIds } = await getUserSiteIds(supabase, user.id);

    if (!allSites && siteIds.length === 0) return reply.send({ count: 0 });

    // Получаем id активных заявок (на этапе согласования)
    let activeQuery = supabase.from('payment_requests').select('id')
      .eq('is_deleted', false).is('withdrawn_at', null)
      .not('current_stage', 'is', null);
    if (!allSites) activeQuery = activeQuery.in('site_id', siteIds);

    const { data: activeRequests, error: activeErr } = await activeQuery;
    if (activeErr) return reply.status(500).send({ error: activeErr.message });
    if (!activeRequests || activeRequests.length === 0) return reply.send({ count: 0 });

    // Заявки с назначенным специалистом
    const { data: assignedIds } = await supabase
      .from('payment_request_assignments')
      .select('payment_request_id')
      .eq('is_current', true);
    const assignedSet = new Set((assignedIds ?? []).map((a: Record<string, unknown>) => a.payment_request_id as string));

    const unassignedCount = activeRequests.filter(
      (r: Record<string, unknown>) => !assignedSet.has(r.id as string)
    ).length;

    return reply.send({ count: unassignedCount });
  });

  /* ---------- GET /api/approvals/omts-rp-count ---------- */
  /* Количество ожидающих ОМТС РП заявок */
  fastify.get('/api/approvals/omts-rp-count', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;
    const { allSites, siteIds } = await getUserSiteIds(supabase, user.id);

    const { data: decisions, error: decErr } = await supabase
      .from('approval_decisions').select('payment_request_id')
      .eq('department_id', 'omts').eq('status', 'pending').eq('is_omts_rp', true);
    if (decErr) return reply.status(500).send({ error: decErr.message });

    const requestIds = [...new Set((decisions ?? []).map((d: Record<string, unknown>) => d.payment_request_id as string))];
    if (requestIds.length === 0 || (!allSites && siteIds.length === 0)) return reply.send({ count: 0 });

    let q = supabase.from('payment_requests').select('id', { count: 'exact', head: true })
      .in('id', requestIds).eq('is_deleted', false).is('withdrawn_at', null);
    if (!allSites) q = q.in('site_id', siteIds);

    const { count, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ count: count ?? 0 });
  });

  /* ---------- GET /api/approvals/ready-for-closure-count ---------- */
  /* Количество согласованных заявок, готовых к закрытию */
  fastify.get('/api/approvals/ready-for-closure-count', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;
    const { allSites, siteIds } = await getUserSiteIds(supabase, user.id);

    if (!allSites && siteIds.length === 0) return reply.send({ count: 0 });

    // Согласованные заявки, у которых нет даты закрытия
    let q = supabase.from('payment_requests').select('id', { count: 'exact', head: true })
      .not('approved_at', 'is', null)
      .is('closed_at', null)
      .eq('is_deleted', false);
    if (!allSites) q = q.in('site_id', siteIds);

    const { count, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ count: count ?? 0 });
  });
}

export default approvalExtraRoutes;
