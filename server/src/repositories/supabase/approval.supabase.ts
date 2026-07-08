/**
 * SupabaseApprovalRepository — rollback-провайдер согласований (Iteration 5, Phase 7).
 * Дословный порт логики роутов approvals.ts / approval-extra.ts и хелперов: машина состояний
 * (Штаб → ОМТС → [ОМТС-РП] → Согласовано | Отклонено | Доработка), очереди, счётчики.
 * Поведение (статусы/тексты/порядок side-effect'ов) сохранено байт-в-байт.
 *
 * ВНИМАНИЕ (принцип 2, поведение заморожено): независимый этап «РП» (stage 3,
 * department_id='rp', rp_stage_assignees — миграции 0015/0016) реализован ТОЛЬКО в Drizzle.
 * Здесь listRpPending/countRpPending сохраняют старую семантику под-этапа ОМТС-РП
 * (is_omts_rp=true), матчинг решений — по department из тела; в legacy-БД новых сущностей нет.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ApprovalRepository,
  ApprovalDecideInput,
  ApprovalDecideResult,
  ApprovalCreateDecisionResult,
  ApprovalOpResult,
  AddDecisionFileInput,
  QueryScope,
  Row,
} from '../approval.repository.js';
import type { ApprovalFieldUpdates } from '../../schemas/approval.js';
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
} from '../../services/notification-helpers.js';
import { isSupplierSbRejected } from '../../services/supplierSecurity.js';

export class SupabaseApprovalRepository implements ApprovalRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /* ================================================================== */
  /*  READ: решения и логи                                              */
  /* ================================================================== */

  async listDecisionsByRequest(requestId: string): Promise<Row[]> {
    const { data: decisions, error: decErr } = await this.supabase
      .from('approval_decisions')
      .select('*, users(email, full_name)')
      .eq('payment_request_id', requestId)
      .order('stage_order', { ascending: true });
    if (decErr) throw new Error(decErr.message);

    const decisionIds = (decisions ?? []).map((d: Row) => d.id as string);
    const filesMap: Record<string, Row[]> = {};
    if (decisionIds.length > 0) {
      const { data: files } = await this.supabase
        .from('approval_decision_files')
        .select(
          'id, approval_decision_id, file_name, file_key, file_size, mime_type, created_by, created_at',
        )
        .in('approval_decision_id', decisionIds)
        .order('created_at', { ascending: true });
      for (const f of files ?? []) {
        const did = (f as Row).approval_decision_id as string;
        if (!filesMap[did]) filesMap[did] = [];
        filesMap[did].push(f as Row);
      }
    }

    return (decisions ?? []).map((d: Row) => ({
      ...flattenApprovalDecision(d),
      files: filesMap[d.id as string] ?? [],
    }));
  }

  async listLogsByRequest(requestId: string): Promise<Row[]> {
    const { data, error } = await this.supabase
      .from('payment_request_logs')
      .select('*, users(email, full_name)')
      .eq('payment_request_id', requestId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: Row) => flattenApprovalDecision(r));
  }

  /* ================================================================== */
  /*  READ: очереди (site-scope через getUserSiteIds)                    */
  /* ================================================================== */

  /** Общий помощник: id заявок с pending-решением в департаменте (+ОМТС-РП gate). */
  private async pendingRequestIds(
    userId: string,
    department: string,
    isAdmin: boolean,
  ): Promise<string[]> {
    let decisionsQuery = this.supabase
      .from('approval_decisions')
      .select('payment_request_id')
      .eq('department_id', department)
      .eq('status', 'pending');

    if (department === 'omts' && !isAdmin) {
      const { data: rpConfig } = await this.supabase
        .from('settings')
        .select('value')
        .eq('key', 'omts_rp_config')
        .single();
      const rpResponsibleId = (rpConfig?.value as Row)?.responsible_user_id as string | null;
      if (userId !== rpResponsibleId) decisionsQuery = decisionsQuery.eq('is_omts_rp', false);
    }

    const { data: decisions, error: decErr } = await decisionsQuery;
    if (decErr) throw new Error(decErr.message);
    return [...new Set((decisions ?? []).map((d: Row) => d.payment_request_id as string))];
  }

  async listPendingByDepartment(opts: {
    userId: string;
    department: string;
    isAdmin: boolean;
  }): Promise<Row[]> {
    const { allSites, siteIds: userSiteIds } = await getUserSiteIds(this.supabase, opts.userId);
    const requestIds = await this.pendingRequestIds(opts.userId, opts.department, opts.isAdmin);
    if (requestIds.length === 0 || (!allSites && userSiteIds.length === 0)) return [];

    let prQuery = this.supabase
      .from('payment_requests')
      .select(PR_SELECT)
      .in('id', requestIds)
      .eq('is_deleted', false)
      .is('withdrawn_at', null)
      // Заявки на доработке из очереди согласования исключаем (см. drizzle-паритет).
      .is('previous_status_id', null)
      .order('created_at', { ascending: false });
    if (!allSites) prQuery = prQuery.in('site_id', userSiteIds);

    const { data, error } = await prQuery;
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: Row) => flattenPaymentRequest(r));
  }

  // Legacy-семантика под-этапа ОМТС-РП (is_omts_rp=true); opts.isAdmin игнорируется.
  async listRpPending(opts: { userId: string; isAdmin: boolean }): Promise<Row[]> {
    const { allSites, siteIds: userSiteIds } = await getUserSiteIds(this.supabase, opts.userId);

    const { data: decisions, error: decErr } = await this.supabase
      .from('approval_decisions')
      .select('payment_request_id')
      .eq('department_id', 'omts')
      .eq('status', 'pending')
      .eq('is_omts_rp', true);
    if (decErr) throw new Error(decErr.message);

    const requestIds = [
      ...new Set((decisions ?? []).map((d: Row) => d.payment_request_id as string)),
    ];
    if (requestIds.length === 0 || (!allSites && userSiteIds.length === 0)) return [];

    let prQuery = this.supabase
      .from('payment_requests')
      .select(PR_SELECT)
      .in('id', requestIds)
      .eq('is_deleted', false)
      .is('withdrawn_at', null)
      // Заявки на доработке из очереди согласования исключаем (см. drizzle-паритет).
      .is('previous_status_id', null)
      .order('created_at', { ascending: false });
    if (!allSites) prQuery = prQuery.in('site_id', userSiteIds);

    const { data, error } = await prQuery;
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: Row) => flattenPaymentRequest(r));
  }

  async listApproved(opts: { userId: string }): Promise<{ data: Row[]; total: number }> {
    const { allSites, siteIds } = await getUserSiteIds(this.supabase, opts.userId);
    let q = this.supabase
      .from('payment_requests')
      .select(PR_SELECT, { count: 'exact' })
      .not('approved_at', 'is', null)
      .eq('is_deleted', false)
      .order('approved_at', { ascending: false });
    if (!allSites && siteIds.length > 0) q = q.in('site_id', siteIds);
    else if (!allSites) return { data: [], total: 0 };

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return { data: (data ?? []).map((r: Row) => flattenPaymentRequest(r)), total: count ?? 0 };
  }

  async listRejected(opts: { userId: string }): Promise<{ data: Row[]; total: number }> {
    const { allSites, siteIds } = await getUserSiteIds(this.supabase, opts.userId);
    let q = this.supabase
      .from('payment_requests')
      .select(PR_SELECT, { count: 'exact' })
      .not('rejected_at', 'is', null)
      .eq('is_deleted', false)
      .order('rejected_at', { ascending: false });
    if (!allSites && siteIds.length > 0) q = q.in('site_id', siteIds);
    else if (!allSites) return { data: [], total: 0 };

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return { data: (data ?? []).map((r: Row) => flattenPaymentRequest(r)), total: count ?? 0 };
  }

  /* ================================================================== */
  /*  READ: массивы (site-scope из query)                               */
  /* ================================================================== */

  async listApprovedArray(opts: QueryScope): Promise<Row[]> {
    if (!opts.allSites && opts.siteIds.length === 0) return [];
    let q = this.supabase
      .from('payment_requests')
      .select(PR_SELECT)
      .not('approved_at', 'is', null)
      .order('approved_at', { ascending: false });
    if (!opts.showDeleted) q = q.eq('is_deleted', false);
    if (!opts.allSites) q = q.in('site_id', opts.siteIds);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: Row) => flattenPaymentRequest(r));
  }

  async listRejectedArray(opts: QueryScope): Promise<Row[]> {
    if (!opts.allSites && opts.siteIds.length === 0) return [];
    let q = this.supabase
      .from('payment_requests')
      .select(PR_SELECT)
      .not('rejected_at', 'is', null)
      .order('rejected_at', { ascending: false });
    if (!opts.showDeleted) q = q.eq('is_deleted', false);
    if (!opts.allSites) q = q.in('site_id', opts.siteIds);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: Row) => flattenPaymentRequest(r));
  }

  /* ================================================================== */
  /*  READ: счётчики                                                    */
  /* ================================================================== */

  async countApproved(opts: QueryScope): Promise<number> {
    let q = this.supabase
      .from('payment_requests')
      .select('id', { count: 'exact', head: true })
      .not('approved_at', 'is', null);
    if (!opts.showDeleted) q = q.eq('is_deleted', false);
    if (!opts.allSites && opts.siteIds.length > 0) q = q.in('site_id', opts.siteIds);
    else if (!opts.allSites) return 0;
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async countRejected(opts: QueryScope): Promise<number> {
    let q = this.supabase
      .from('payment_requests')
      .select('id', { count: 'exact', head: true })
      .not('rejected_at', 'is', null);
    if (!opts.showDeleted) q = q.eq('is_deleted', false);
    if (!opts.allSites && opts.siteIds.length > 0) q = q.in('site_id', opts.siteIds);
    else if (!opts.allSites) return 0;
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async countAll(opts: QueryScope): Promise<number> {
    if (!opts.allSites && opts.siteIds.length === 0) return 0;
    let q = this.supabase
      .from('payment_requests')
      .select('id', { count: 'exact', head: true })
      .eq('is_deleted', false);
    if (!opts.allSites) q = q.in('site_id', opts.siteIds);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async countPendingByDepartment(opts: {
    userId: string;
    department: string;
    isAdmin: boolean;
  }): Promise<number> {
    const { allSites, siteIds: userSiteIds } = await getUserSiteIds(this.supabase, opts.userId);
    const requestIds = await this.pendingRequestIds(opts.userId, opts.department, opts.isAdmin);
    if (requestIds.length === 0 || (!allSites && userSiteIds.length === 0)) return 0;

    let prQuery = this.supabase
      .from('payment_requests')
      .select('id', { count: 'exact', head: true })
      .in('id', requestIds)
      .eq('is_deleted', false)
      .is('withdrawn_at', null)
      // Счётчик вкладки согласуем с очередью: заявки на доработке не считаем.
      .is('previous_status_id', null);
    if (!allSites) prQuery = prQuery.in('site_id', userSiteIds);
    const { count, error } = await prQuery;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async countUnassignedSpecialists(opts: { userId: string }): Promise<number> {
    const { allSites, siteIds } = await getUserSiteIds(this.supabase, opts.userId);
    if (!allSites && siteIds.length === 0) return 0;

    let activeQuery = this.supabase
      .from('payment_requests')
      .select('id')
      .eq('is_deleted', false)
      .is('withdrawn_at', null)
      .not('current_stage', 'is', null);
    if (!allSites) activeQuery = activeQuery.in('site_id', siteIds);

    const { data: activeRequests, error: activeErr } = await activeQuery;
    if (activeErr) throw new Error(activeErr.message);
    if (!activeRequests || activeRequests.length === 0) return 0;

    const { data: assignedIds } = await this.supabase
      .from('payment_request_assignments')
      .select('payment_request_id')
      .eq('is_current', true);
    const assignedSet = new Set(
      (assignedIds ?? []).map((a: Row) => a.payment_request_id as string),
    );

    return activeRequests.filter((r: Row) => !assignedSet.has(r.id as string)).length;
  }

  // Legacy-семантика под-этапа ОМТС-РП (is_omts_rp=true); opts.isAdmin игнорируется.
  async countRpPending(opts: { userId: string; isAdmin: boolean }): Promise<number> {
    const { allSites, siteIds } = await getUserSiteIds(this.supabase, opts.userId);

    const { data: decisions, error: decErr } = await this.supabase
      .from('approval_decisions')
      .select('payment_request_id')
      .eq('department_id', 'omts')
      .eq('status', 'pending')
      .eq('is_omts_rp', true);
    if (decErr) throw new Error(decErr.message);

    const requestIds = [
      ...new Set((decisions ?? []).map((d: Row) => d.payment_request_id as string)),
    ];
    if (requestIds.length === 0 || (!allSites && siteIds.length === 0)) return 0;

    let q = this.supabase
      .from('payment_requests')
      .select('id', { count: 'exact', head: true })
      .in('id', requestIds)
      .eq('is_deleted', false)
      .is('withdrawn_at', null);
    if (!allSites) q = q.in('site_id', siteIds);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async countReadyForClosure(opts: { userId: string }): Promise<number> {
    const { allSites, siteIds } = await getUserSiteIds(this.supabase, opts.userId);
    if (!allSites && siteIds.length === 0) return 0;

    let q = this.supabase
      .from('payment_requests')
      .select('id', { count: 'exact', head: true })
      .not('approved_at', 'is', null)
      .is('closed_at', null)
      .eq('is_deleted', false);
    if (!allSites) q = q.in('site_id', siteIds);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  /* ================================================================== */
  /*  WRITE: машина состояний                                           */
  /* ================================================================== */

  async decide(input: ApprovalDecideInput): Promise<ApprovalDecideResult> {
    const { data: pr, error: prError } = await this.supabase
      .from('payment_requests')
      .select(
        'current_stage, site_id, withdrawn_at, rejected_at, rejected_stage, status_id, supplier_id, previous_status_id',
      )
      .eq('id', input.paymentRequestId)
      .single();
    if (prError) return { ok: false, status: 404, error: 'Заявка не найдена' };
    if (pr.withdrawn_at) {
      return { ok: false, status: 400, error: 'Невозможно обработать отозванную заявку' };
    }

    const currentStage = pr.current_stage as number;
    const siteId = pr.site_id as string;
    const userInfo = await getUserInfo(this.supabase, input.userId);

    if (input.action === 'approve') {
      // Заявку на доработке нельзя согласовать: сперва «Доработано» вернёт её на прежнюю стадию
      // с ещё живым pending-решением (см. drizzle-паритет).
      if (pr.previous_status_id) {
        return {
          ok: false,
          status: 409,
          error: 'Заявка находится на доработке — сначала завершите доработку',
        };
      }
      if (await isSupplierSbRejected(this.supabase, pr.supplier_id as string | null)) {
        return {
          ok: false,
          status: 403,
          error: 'Поставщик отклонён службой безопасности — согласование невозможно',
        };
      }
      return this.approve(input, currentStage, siteId, userInfo);
    }

    const { data: curStatus } = await this.supabase
      .from('statuses')
      .select('code')
      .eq('id', pr.status_id as string)
      .single();
    if (curStatus?.code === 'rejected') {
      return { ok: false, status: 400, error: 'Заявка уже отклонена' };
    }
    if (curStatus?.code === 'approved') {
      return { ok: false, status: 400, error: 'Нельзя отклонить согласованную заявку' };
    }
    return this.reject(input, currentStage, userInfo, input.isAdmin);
  }

  private async approve(
    input: ApprovalDecideInput,
    currentStage: number,
    siteId: string,
    userInfo: { email?: string; fullName?: string },
  ): Promise<ApprovalDecideResult> {
    const { data: pending, error: pendingErr } = await this.supabase
      .from('approval_decisions')
      .select('id, is_omts_rp')
      .eq('payment_request_id', input.paymentRequestId)
      .eq('stage_order', currentStage)
      .eq('department_id', input.department)
      .eq('status', 'pending')
      .single();
    if (pendingErr) return { ok: false, status: 404, error: 'Решение не найдено' };

    await this.supabase
      .from('approval_decisions')
      .update({
        status: 'approved',
        user_id: input.userId,
        comment: input.comment,
        decided_at: new Date().toISOString(),
      })
      .eq('id', pending.id);

    const isCurrentOmtsRp = pending.is_omts_rp as boolean;
    await appendStageHistory(this.supabase, input.paymentRequestId, {
      stage: currentStage,
      department: input.department,
      event: 'approved',
      userEmail: userInfo.email,
      userFullName: userInfo.fullName,
      ...(isCurrentOmtsRp ? { isOmtsRp: true } : {}),
    });

    if (currentStage === 1) {
      await this.supabase.from('approval_decisions').insert({
        payment_request_id: input.paymentRequestId,
        stage_order: 2,
        department_id: 'omts',
        status: 'pending',
        is_omts_rp: false,
      });
      await appendStageHistory(this.supabase, input.paymentRequestId, {
        stage: 2,
        department: 'omts',
        event: 'received',
      });
      const omtsStatusId = await getStatusId(this.supabase, 'payment_request', 'approv_omts');
      await this.supabase
        .from('payment_requests')
        .update({
          current_stage: 2,
          status_id: omtsStatusId,
          omts_entered_at: new Date().toISOString(),
          previous_status_id: null,
        })
        .eq('id', input.paymentRequestId);
    } else if (currentStage === 2) {
      const { data: settingsData } = await this.supabase
        .from('settings')
        .select('value')
        .eq('key', 'omts_rp_sites')
        .single();
      const omtsRpSiteIds = ((settingsData?.value as Row)?.site_ids as string[]) ?? [];
      const needsOmtsRp = omtsRpSiteIds.includes(siteId);

      if (!isCurrentOmtsRp && needsOmtsRp) {
        await this.supabase.from('approval_decisions').insert({
          payment_request_id: input.paymentRequestId,
          stage_order: 2,
          department_id: 'omts',
          status: 'pending',
          is_omts_rp: true,
        });
        await appendStageHistory(this.supabase, input.paymentRequestId, {
          stage: 2,
          department: 'omts',
          event: 'received',
          isOmtsRp: true,
        });
        const rpStatusId = await getStatusId(this.supabase, 'payment_request', 'approv_omts_rp');
        await this.supabase
          .from('payment_requests')
          .update({
            status_id: rpStatusId,
            omts_approved_at: new Date().toISOString(),
            previous_status_id: null,
          })
          .eq('id', input.paymentRequestId);
      } else {
        const approvedStatusId = await getStatusId(this.supabase, 'payment_request', 'approved');
        await this.supabase
          .from('payment_requests')
          .update({
            status_id: approvedStatusId,
            current_stage: null,
            approved_at: new Date().toISOString(),
            omts_approved_at: new Date().toISOString(),
            previous_status_id: null,
          })
          .eq('id', input.paymentRequestId);

        const creatorId = await getPaymentRequestCreator(this.supabase, input.paymentRequestId);
        if (creatorId && creatorId !== input.userId) {
          const { data: req } = await this.supabase
            .from('payment_requests')
            .select('request_number')
            .eq('id', input.paymentRequestId)
            .single();
          const label = req?.request_number ? ` N${req.request_number}` : '';
          insertNotifications(this.supabase, [
            {
              user_id: creatorId,
              type: 'status_changed',
              title: 'Заявка согласована',
              message: `Заявка${label} согласована`,
              payment_request_id: input.paymentRequestId,
            },
          ]).catch(() => {});
        }
      }
    }

    return { ok: true };
  }

  private async reject(
    input: ApprovalDecideInput,
    currentStage: number,
    userInfo: { email?: string; fullName?: string },
    isAdmin: boolean,
  ): Promise<ApprovalDecideResult> {
    const { data: pendingDecision } = await this.supabase
      .from('approval_decisions')
      .select('id, stage_order, department_id')
      .eq('payment_request_id', input.paymentRequestId)
      .eq('stage_order', currentStage)
      .eq('department_id', input.department)
      .eq('status', 'pending')
      .maybeSingle();

    let decisionId: string | null = null;
    let effectiveStage: number | null = currentStage ?? null;
    // department в теле — легаси (в интерфейсе optional); фолбэк 'omts' как в старом коде.
    let effectiveDepartment: string = input.department ?? 'omts';

    if (pendingDecision) {
      const { data: upd, error: updErr } = await this.supabase
        .from('approval_decisions')
        .update({
          status: 'rejected',
          user_id: input.userId,
          comment: input.comment,
          decided_at: new Date().toISOString(),
        })
        .eq('id', pendingDecision.id as string)
        .select('id')
        .single();
      if (updErr) return { ok: false, status: 500, error: updErr.message };
      decisionId = upd.id as string;
    } else {
      if (!isAdmin) return { ok: false, status: 404, error: 'Решение не найдено' };

      const { data: pendingList } = await this.supabase
        .from('approval_decisions')
        .select('id, stage_order, department_id')
        .eq('payment_request_id', input.paymentRequestId)
        .eq('status', 'pending');
      if (pendingList && pendingList.length > 0) {
        await this.supabase
          .from('approval_decisions')
          .update({
            status: 'rejected',
            user_id: input.userId,
            comment: input.comment,
            decided_at: new Date().toISOString(),
          })
          .eq('payment_request_id', input.paymentRequestId)
          .eq('status', 'pending');
        decisionId = (pendingList[0] as Row).id as string;
        effectiveStage = ((pendingList[0] as Row).stage_order as number) ?? effectiveStage;
        effectiveDepartment =
          ((pendingList[0] as Row).department_id as string) ?? effectiveDepartment;
      } else {
        const { data: lastDec } = await this.supabase
          .from('approval_decisions')
          .select('id, stage_order, department_id')
          .eq('payment_request_id', input.paymentRequestId)
          .order('stage_order', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastDec) {
          decisionId = (lastDec as Row).id as string;
          effectiveStage = ((lastDec as Row).stage_order as number) ?? effectiveStage;
          effectiveDepartment = ((lastDec as Row).department_id as string) ?? effectiveDepartment;
        }
      }
    }

    const rejectedStatusId = await getStatusId(this.supabase, 'payment_request', 'rejected');
    await this.supabase
      .from('payment_requests')
      .update({
        status_id: rejectedStatusId,
        rejected_stage: effectiveStage,
        current_stage: null,
        rejected_at: new Date().toISOString(),
        previous_status_id: null,
      })
      .eq('id', input.paymentRequestId);

    const { data: prData } = await this.supabase
      .from('payment_requests')
      .select('request_number')
      .eq('id', input.paymentRequestId)
      .single();

    await appendStageHistory(this.supabase, input.paymentRequestId, {
      stage: effectiveStage ?? currentStage,
      department: effectiveDepartment,
      event: 'rejected',
      userEmail: userInfo.email,
      userFullName: userInfo.fullName,
      comment: input.comment || undefined,
    });

    return { ok: true, decisionId, requestNumber: (prData?.request_number as string) ?? '' };
  }

  async sendToRevision(
    paymentRequestId: string,
    userId: string,
    comment: string,
  ): Promise<ApprovalOpResult> {
    const result = await handleSendToRevision(this.supabase, paymentRequestId, userId, comment);
    if (!result.success)
      return { ok: false, status: result.status ?? 500, error: result.error ?? '' };
    return { ok: true };
  }

  async completeRevision(
    paymentRequestId: string,
    userId: string,
    fieldUpdates: ApprovalFieldUpdates,
  ): Promise<ApprovalOpResult> {
    const result = await handleCompleteRevision(
      this.supabase,
      paymentRequestId,
      userId,
      fieldUpdates,
    );
    if (!result.success)
      return { ok: false, status: result.status ?? 500, error: result.error ?? '' };
    return { ok: true };
  }

  async appendStageHistory(paymentRequestId: string, entry: Row): Promise<void> {
    await appendStageHistory(this.supabase, paymentRequestId, entry);
  }

  async createDecisionOnly(input: ApprovalDecideInput): Promise<ApprovalCreateDecisionResult> {
    const { data: pr, error: prError } = await this.supabase
      .from('payment_requests')
      .select('current_stage, site_id, withdrawn_at')
      .eq('id', input.paymentRequestId)
      .single();
    if (prError) return { ok: false, status: 404, error: 'Заявка не найдена' };
    if (pr.withdrawn_at) {
      return { ok: false, status: 400, error: 'Невозможно обработать отозванную заявку' };
    }

    const currentStage = pr.current_stage as number;
    const { data: decision, error: decErr } = await this.supabase
      .from('approval_decisions')
      .update({
        status: input.action === 'approve' ? 'approved' : 'rejected',
        user_id: input.userId,
        comment: input.comment,
        decided_at: new Date().toISOString(),
      })
      .eq('payment_request_id', input.paymentRequestId)
      .eq('stage_order', currentStage)
      .eq('department_id', input.department)
      .eq('status', 'pending')
      .select('id')
      .single();
    if (decErr) return { ok: false, status: 404, error: 'Решение не найдено' };

    return { ok: true, decisionId: decision.id as string };
  }

  /* ================================================================== */
  /*  WRITE: файлы решений                                              */
  /* ================================================================== */

  async addDecisionFile(file: AddDecisionFileInput): Promise<{ id: string }> {
    const { data, error } = await this.supabase
      .from('approval_decision_files')
      .insert({
        approval_decision_id: file.approvalDecisionId,
        file_name: file.fileName,
        file_key: file.fileKey,
        file_size: file.fileSize,
        mime_type: file.mimeType,
        created_by: file.createdBy,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id as string };
  }

  async deleteDecisionFile(id: string): Promise<void> {
    const { error } = await this.supabase.from('approval_decision_files').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
