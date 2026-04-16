import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  getStatusId,
  appendStageHistory,
  getUserInfo,
  getUserSiteIds,
  handleSendToRevision,
  handleCompleteRevision,
  PR_SELECT,
  flattenPaymentRequest,
  flattenApprovalDecision,
} from './approval-helpers.js';
import {
  getPaymentRequestCreator,
  insertNotifications,
} from '../services/notification-helpers.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов согласований                                      */
/* ------------------------------------------------------------------ */

async function approvalRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };
  const anyAuthenticated = { preHandler: [authenticate, requireRole('admin', 'user', 'counterparty_user')] };

  /* ---------- GET /api/approvals/payment-request/:requestId ---------- */
  fastify.get('/api/approvals/payment-request/:requestId', anyAuthenticated, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const supabase = fastify.supabase;

    const { data: decisions, error: decErr } = await supabase
      .from('approval_decisions')
      .select('*, users(email, full_name)')
      .eq('payment_request_id', requestId)
      .order('stage_order', { ascending: true });
    if (decErr) return reply.status(500).send({ error: decErr.message });

    // Файлы для решений (одним запросом)
    const decisionIds = (decisions ?? []).map((d: Record<string, unknown>) => d.id as string);
    const filesMap: Record<string, Record<string, unknown>[]> = {};

    if (decisionIds.length > 0) {
      const { data: files } = await supabase
        .from('approval_decision_files')
        .select('id, approval_decision_id, file_name, file_key, file_size, mime_type, created_by, created_at')
        .in('approval_decision_id', decisionIds)
        .order('created_at', { ascending: true });
      for (const f of files ?? []) {
        const did = (f as Record<string, unknown>).approval_decision_id as string;
        if (!filesMap[did]) filesMap[did] = [];
        filesMap[did].push(f as Record<string, unknown>);
      }
    }

    const enriched = (decisions ?? []).map((d: Record<string, unknown>) => ({
      ...flattenApprovalDecision(d),
      files: filesMap[d.id as string] ?? [],
    }));

    return reply.send(enriched);
  });

  /* ---------- GET /api/approvals/payment-request/:requestId/logs ---------- */
  fastify.get('/api/approvals/payment-request/:requestId/logs', anyAuthenticated, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('payment_request_logs')
      .select('*, users(email, full_name)')
      .eq('payment_request_id', requestId)
      .order('created_at', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send((data ?? []).map((r: Record<string, unknown>) => flattenApprovalDecision(r)));
  });

  /* ---------- POST /api/approvals/decide ---------- */
  fastify.post('/api/approvals/decide', adminOrUser, async (request, reply) => {
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
    const siteId = pr.site_id as string;
    const userInfo = await getUserInfo(supabase, user.id);

    if (body.action === 'approve') {
      return await handleApprove(fastify, reply, body, user.id, currentStage, siteId, userInfo);
    } else {
      return await handleReject(fastify, reply, body, user.id, currentStage, userInfo);
    }
  });

  /* ---------- POST /api/approvals/send-to-revision ---------- */
  fastify.post('/api/approvals/send-to-revision', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const body = request.body as { paymentRequestId: string; comment: string };

    const result = await handleSendToRevision(fastify.supabase, body.paymentRequestId, user.id, body.comment);
    if (!result.success) return reply.status(result.status ?? 500).send({ error: result.error });
    return reply.send({ success: true });
  });

  /* ---------- POST /api/approvals/complete-revision ---------- */
  fastify.post('/api/approvals/complete-revision', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user!;
    const body = request.body as {
      paymentRequestId: string;
      fieldUpdates: { deliveryDays: number; deliveryDaysType: string; shippingConditionId: string; invoiceAmount: number; supplierId?: string | null };
    };

    const result = await handleCompleteRevision(fastify.supabase, body.paymentRequestId, user.id, body.fieldUpdates);
    if (!result.success) return reply.status(result.status ?? 500).send({ error: result.error });
    return reply.send({ success: true });
  });

  /* ---------- POST /api/approvals/decision-files ---------- */
  fastify.post('/api/approvals/decision-files', adminOrUser, async (request, reply) => {
    const body = request.body as {
      approvalDecisionId: string; fileName: string; fileKey: string;
      fileSize: number | null; mimeType: string | null; createdBy: string;
    };
    const { data, error } = await fastify.supabase
      .from('approval_decision_files')
      .insert({
        approval_decision_id: body.approvalDecisionId, file_name: body.fileName,
        file_key: body.fileKey, file_size: body.fileSize, mime_type: body.mimeType,
        created_by: body.createdBy,
      })
      .select('id').single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send({ data });
  });

  /* ---------- DELETE /api/approvals/decision-files/:id ---------- */
  fastify.delete('/api/approvals/decision-files/:id', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { error } = await fastify.supabase.from('approval_decision_files').delete().eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ success: true });
  });

  /* ---------- GET /api/approvals/pending ---------- */
  fastify.get('/api/approvals/pending', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const query = request.query as { department: string; isAdmin?: string };
    const supabase = fastify.supabase;
    const department = query.department;
    const isAdmin = query.isAdmin === 'true' || user.role === 'admin';

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
    if (requestIds.length === 0 || (!allSites && userSiteIds.length === 0)) return reply.send([]);

    let prQuery = supabase.from('payment_requests').select(PR_SELECT)
      .in('id', requestIds).eq('is_deleted', false).is('withdrawn_at', null)
      .order('created_at', { ascending: false });
    if (!allSites) prQuery = prQuery.in('site_id', userSiteIds);

    const { data, error } = await prQuery;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send((data ?? []).map((r: Record<string, unknown>) => flattenPaymentRequest(r)));
  });

  /* ---------- GET /api/approvals/pending-requests ---------- */
  fastify.get('/api/approvals/pending-requests', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const query = request.query as { department: string; userId?: string; isAdmin?: string };
    const supabase = fastify.supabase;
    const department = query.department;
    const isAdmin = query.isAdmin === 'true' || user.role === 'admin';

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
    if (requestIds.length === 0 || (!allSites && userSiteIds.length === 0)) return reply.send([]);

    let prQuery = supabase.from('payment_requests').select(PR_SELECT)
      .in('id', requestIds).eq('is_deleted', false).is('withdrawn_at', null)
      .order('created_at', { ascending: false });
    if (!allSites) prQuery = prQuery.in('site_id', userSiteIds);

    const { data, error } = await prQuery;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send((data ?? []).map((r: Record<string, unknown>) => flattenPaymentRequest(r)));
  });

  /* ---------- GET /api/approvals/omts-rp-pending-requests ---------- */
  fastify.get('/api/approvals/omts-rp-pending-requests', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;

    const { allSites, siteIds: userSiteIds } = await getUserSiteIds(supabase, user.id);

    const { data: decisions, error: decErr } = await supabase
      .from('approval_decisions').select('payment_request_id')
      .eq('department_id', 'omts').eq('status', 'pending').eq('is_omts_rp', true);
    if (decErr) return reply.status(500).send({ error: decErr.message });

    const requestIds = [...new Set((decisions ?? []).map((d: Record<string, unknown>) => d.payment_request_id as string))];
    if (requestIds.length === 0 || (!allSites && userSiteIds.length === 0)) return reply.send([]);

    let prQuery = supabase.from('payment_requests').select(PR_SELECT)
      .in('id', requestIds).eq('is_deleted', false).is('withdrawn_at', null)
      .order('created_at', { ascending: false });
    if (!allSites) prQuery = prQuery.in('site_id', userSiteIds);

    const { data, error } = await prQuery;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send((data ?? []).map((r: Record<string, unknown>) => flattenPaymentRequest(r)));
  });

  /* ---------- GET /api/approvals/approved ---------- */
  fastify.get('/api/approvals/approved', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;
    const { allSites, siteIds } = await getUserSiteIds(supabase, user.id);

    let q = supabase.from('payment_requests').select(PR_SELECT, { count: 'exact' })
      .not('approved_at', 'is', null).eq('is_deleted', false).order('approved_at', { ascending: false });
    if (!allSites && siteIds.length > 0) q = q.in('site_id', siteIds);
    else if (!allSites) return reply.send({ data: [], total: 0 });

    const { data, error, count } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ data: (data ?? []).map((r: Record<string, unknown>) => flattenPaymentRequest(r)), total: count ?? 0 });
  });

  /* ---------- GET /api/approvals/approved-count ---------- */
  fastify.get('/api/approvals/approved-count', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;
    const query = request.query as { allSites?: string; siteIds?: string };

    const allSites = query.allSites === 'true' || user.role === 'admin';
    const siteIds = query.siteIds ? query.siteIds.split(',') : [];

    let q = supabase.from('payment_requests').select('id', { count: 'exact', head: true })
      .not('approved_at', 'is', null).eq('is_deleted', false);
    if (!allSites && siteIds.length > 0) q = q.in('site_id', siteIds);
    else if (!allSites) return reply.send({ count: 0 });

    const { count, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ count: count ?? 0 });
  });

  /* ---------- GET /api/approvals/rejected ---------- */
  fastify.get('/api/approvals/rejected', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;
    const { allSites, siteIds } = await getUserSiteIds(supabase, user.id);

    let q = supabase.from('payment_requests').select(PR_SELECT, { count: 'exact' })
      .not('rejected_at', 'is', null).eq('is_deleted', false).order('rejected_at', { ascending: false });
    if (!allSites && siteIds.length > 0) q = q.in('site_id', siteIds);
    else if (!allSites) return reply.send({ data: [], total: 0 });

    const { data, error, count } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ data: (data ?? []).map((r: Record<string, unknown>) => flattenPaymentRequest(r)), total: count ?? 0 });
  });

  /* ---------- GET /api/approvals/rejected-count ---------- */
  fastify.get('/api/approvals/rejected-count', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;
    const query = request.query as { allSites?: string; siteIds?: string };

    const allSites = query.allSites === 'true' || user.role === 'admin';
    const siteIds = query.siteIds ? query.siteIds.split(',') : [];

    let q = supabase.from('payment_requests').select('id', { count: 'exact', head: true })
      .not('rejected_at', 'is', null).eq('is_deleted', false);
    if (!allSites && siteIds.length > 0) q = q.in('site_id', siteIds);
    else if (!allSites) return reply.send({ count: 0 });

    const { count, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ count: count ?? 0 });
  });
}

/* ------------------------------------------------------------------ */
/*  Обработчики approve / reject (вынесены для читаемости)             */
/* ------------------------------------------------------------------ */

async function handleApprove(
  fastify: FastifyInstance,
  reply: import('fastify').FastifyReply,
  body: { paymentRequestId: string; department: string; comment: string },
  userId: string,
  currentStage: number,
  siteId: string,
  userInfo: { email?: string; fullName?: string },
) {
  const supabase = fastify.supabase;

  const { data: pending, error: pendingErr } = await supabase
    .from('approval_decisions')
    .select('id, is_omts_rp')
    .eq('payment_request_id', body.paymentRequestId)
    .eq('stage_order', currentStage).eq('department_id', body.department).eq('status', 'pending')
    .single();
  if (pendingErr) return reply.status(404).send({ error: 'Решение не найдено' });

  await supabase.from('approval_decisions').update({
    status: 'approved', user_id: userId, comment: body.comment, decided_at: new Date().toISOString(),
  }).eq('id', pending.id);

  const isCurrentOmtsRp = pending.is_omts_rp as boolean;
  await appendStageHistory(supabase, body.paymentRequestId, {
    stage: currentStage, department: body.department, event: 'approved',
    userEmail: userInfo.email, userFullName: userInfo.fullName,
    ...(isCurrentOmtsRp ? { isOmtsRp: true } : {}),
  });

  if (currentStage === 1) {
    await supabase.from('approval_decisions').insert({
      payment_request_id: body.paymentRequestId, stage_order: 2, department_id: 'omts', status: 'pending', is_omts_rp: false,
    });
    await appendStageHistory(supabase, body.paymentRequestId, { stage: 2, department: 'omts', event: 'received' });
    const omtsStatusId = await getStatusId(supabase, 'payment_request', 'approv_omts');
    await supabase.from('payment_requests')
      .update({ current_stage: 2, status_id: omtsStatusId, omts_entered_at: new Date().toISOString() })
      .eq('id', body.paymentRequestId);
  } else if (currentStage === 2) {
    const { data: settingsData } = await supabase.from('settings').select('value').eq('key', 'omts_rp_sites').single();
    const omtsRpSiteIds = ((settingsData?.value as Record<string, unknown>)?.site_ids as string[]) ?? [];
    const needsOmtsRp = omtsRpSiteIds.includes(siteId);

    if (!isCurrentOmtsRp && needsOmtsRp) {
      await supabase.from('approval_decisions').insert({
        payment_request_id: body.paymentRequestId, stage_order: 2, department_id: 'omts', status: 'pending', is_omts_rp: true,
      });
      await appendStageHistory(supabase, body.paymentRequestId, { stage: 2, department: 'omts', event: 'received', isOmtsRp: true });
      const rpStatusId = await getStatusId(supabase, 'payment_request', 'approv_omts_rp');
      await supabase.from('payment_requests')
        .update({ status_id: rpStatusId, omts_approved_at: new Date().toISOString() })
        .eq('id', body.paymentRequestId);
    } else {
      const approvedStatusId = await getStatusId(supabase, 'payment_request', 'approved');
      await supabase.from('payment_requests')
        .update({ status_id: approvedStatusId, current_stage: null, approved_at: new Date().toISOString(), omts_approved_at: new Date().toISOString() })
        .eq('id', body.paymentRequestId);

      // Уведомление подрядчику (создателю заявки) о согласовании
      const creatorId = await getPaymentRequestCreator(supabase, body.paymentRequestId);
      if (creatorId && creatorId !== userId) {
        const { data: req } = await supabase
          .from('payment_requests')
          .select('request_number')
          .eq('id', body.paymentRequestId)
          .single();
        const label = req?.request_number ? ` N${req.request_number}` : '';
        insertNotifications(supabase, [{
          user_id: creatorId,
          type: 'status_changed',
          title: 'Заявка согласована',
          message: `Заявка${label} согласована`,
          payment_request_id: body.paymentRequestId,
        }]).catch(() => {});
      }
    }
  }

  return reply.send({ success: true });
}

async function handleReject(
  fastify: FastifyInstance,
  reply: import('fastify').FastifyReply,
  body: { paymentRequestId: string; department: string; comment: string },
  userId: string,
  currentStage: number,
  userInfo: { email?: string; fullName?: string },
) {
  const supabase = fastify.supabase;

  const { data: decisionData, error: updErr } = await supabase
    .from('approval_decisions').update({
      status: 'rejected', user_id: userId, comment: body.comment, decided_at: new Date().toISOString(),
    })
    .eq('payment_request_id', body.paymentRequestId)
    .eq('stage_order', currentStage).eq('department_id', body.department).eq('status', 'pending')
    .select('id').single();
  if (updErr) return reply.status(500).send({ error: updErr.message });

  const rejectedStatusId = await getStatusId(supabase, 'payment_request', 'rejected');
  await supabase.from('payment_requests').update({
    status_id: rejectedStatusId, rejected_stage: currentStage, current_stage: null, rejected_at: new Date().toISOString(),
  }).eq('id', body.paymentRequestId);

  // Получаем номер заявки для ответа (нужен фронтенду для очереди загрузки файлов)
  const { data: prData } = await supabase
    .from('payment_requests').select('request_number').eq('id', body.paymentRequestId).single();

  await appendStageHistory(supabase, body.paymentRequestId, {
    stage: currentStage, department: body.department, event: 'rejected',
    userEmail: userInfo.email, userFullName: userInfo.fullName,
    comment: body.comment || undefined,
  });

  return reply.send({ success: true, decisionId: decisionData.id, requestNumber: prData?.request_number ?? '' });
}

export default approvalRoutes;
