/**
 * DrizzleApprovalRepository — провайдер согласований по умолчанию (Iteration 5, Phase 7).
 * Воспроизводит машину состояний роутов approvals/approval-extra средствами Drizzle.
 * Все write-операции выполняются в db.transaction() (атомарность переходов — принцип плана).
 * Статусы резолвятся ТОЛЬКО по code (statusIdByCode); финальность — по коду статуса.
 * Уведомление о финальном согласовании отправляется ПОСЛЕ коммита, best-effort (.catch).
 * Доработка согласованной contractor-заявки (approved → revision → complete): completeRevision
 * возвращает её НЕ в approved, а на повторное согласование ОМТС (новая pending-строка), чтобы
 * заявка не согласовывалась без нового решения approver'а; авто-типы восстанавливаются в approved.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  isNotNull,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  approvalDecisions,
  approvalDecisionFiles,
  paymentRequests,
  paymentRequestLogs,
  paymentRequestAssignments,
  statuses,
  settings,
  suppliers,
  users,
  userConstructionSitesMapping,
  notifications,
} from '../../db/schema/index.js';
import { departmentEnum } from '../../db/schema/enums.js';
import { joinedPaymentRequests } from './payment-request-projection.js';
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

type Db = PostgresJsDatabase<typeof schema>;
type AnyTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Department = (typeof departmentEnum.enumValues)[number];

const nowIso = () => new Date().toISOString();

export class DrizzleApprovalRepository implements ApprovalRepository {
  constructor(private readonly db: Db) {}

  /* ---------- общие помощники ---------- */

  private async statusIdByCode(tx: Db | AnyTx, entityType: string, code: string): Promise<string> {
    const [row] = await tx
      .select({ id: statuses.id })
      .from(statuses)
      .where(and(eq(statuses.entityType, entityType), eq(statuses.code, code)))
      .limit(1);
    if (!row) throw new Error(`Статус ${entityType}/${code} не найден`);
    return row.id;
  }

  private async statusCodeById(tx: Db | AnyTx, id: string): Promise<string | null> {
    const [row] = await tx
      .select({ code: statuses.code })
      .from(statuses)
      .where(eq(statuses.id, id))
      .limit(1);
    return row ? row.code : null;
  }

  private async getUserInfo(
    tx: Db | AnyTx,
    userId: string,
  ): Promise<{ email?: string; fullName?: string }> {
    const [row] = await tx
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return { email: row?.email, fullName: row?.fullName };
  }

  private async getUserSiteIds(userId: string): Promise<{ allSites: boolean; siteIds: string[] }> {
    const [u] = await this.db
      .select({ allSites: users.allSites })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (u?.allSites) return { allSites: true, siteIds: [] };
    const rows = await this.db
      .select({ siteId: userConstructionSitesMapping.constructionSiteId })
      .from(userConstructionSitesMapping)
      .where(eq(userConstructionSitesMapping.userId, userId));
    return { allSites: false, siteIds: rows.map((r) => r.siteId) };
  }

  /** Read-modify-write stage_history внутри транзакции. */
  private async appendHistory(tx: AnyTx, paymentRequestId: string, entry: Row): Promise<void> {
    const [pr] = await tx
      .select({ stageHistory: paymentRequests.stageHistory })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, paymentRequestId))
      .limit(1);
    const history = ((pr?.stageHistory as Row[] | null) ?? []).slice();
    history.push({ ...entry, at: nowIso() });
    await tx
      .update(paymentRequests)
      .set({ stageHistory: history })
      .where(eq(paymentRequests.id, paymentRequestId));
  }

  /** id заявок с pending-решением в департаменте (+ОМТС-РП gate для не-ответственных). */
  private async pendingRequestIds(
    userId: string,
    department: string,
    isAdmin: boolean,
  ): Promise<string[]> {
    const conds = [
      eq(approvalDecisions.departmentId, department as Department),
      eq(approvalDecisions.status, 'pending'),
    ];
    if (department === 'omts' && !isAdmin) {
      const [rpConfig] = await this.db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, 'omts_rp_config'))
        .limit(1);
      const rpResponsibleId = (rpConfig?.value as Row)?.responsible_user_id as string | null;
      if (userId !== rpResponsibleId) conds.push(eq(approvalDecisions.isOmtsRp, false));
    }
    const rows = await this.db
      .select({ prId: approvalDecisions.paymentRequestId })
      .from(approvalDecisions)
      .where(and(...conds));
    return [...new Set(rows.map((r) => r.prId))];
  }

  /* ================================================================== */
  /*  READ: решения и логи                                              */
  /* ================================================================== */

  async listDecisionsByRequest(requestId: string): Promise<Row[]> {
    const { departmentId, ...decCols } = getTableColumns(approvalDecisions);
    void departmentId;
    const decisions = await this.db
      .select({
        ...decCols,
        department: approvalDecisions.departmentId,
        userEmail: users.email,
        userFullName: users.fullName,
      })
      .from(approvalDecisions)
      .leftJoin(users, eq(users.id, approvalDecisions.userId))
      .where(eq(approvalDecisions.paymentRequestId, requestId))
      .orderBy(asc(approvalDecisions.stageOrder));

    const decisionIds = decisions.map((d) => d.id as string);
    const filesMap: Record<string, Row[]> = {};
    if (decisionIds.length > 0) {
      const files = await this.db
        .select(getTableColumns(approvalDecisionFiles))
        .from(approvalDecisionFiles)
        .where(inArray(approvalDecisionFiles.approvalDecisionId, decisionIds))
        .orderBy(asc(approvalDecisionFiles.createdAt));
      for (const f of files) {
        const did = f.approvalDecisionId as string;
        if (!filesMap[did]) filesMap[did] = [];
        filesMap[did].push(f as Row);
      }
    }

    return decisions.map((d) => ({ ...d, files: filesMap[d.id as string] ?? [] }));
  }

  async listLogsByRequest(requestId: string): Promise<Row[]> {
    const rows = await this.db
      .select({
        ...getTableColumns(paymentRequestLogs),
        userEmail: users.email,
        userFullName: users.fullName,
      })
      .from(paymentRequestLogs)
      .leftJoin(users, eq(users.id, paymentRequestLogs.userId))
      .where(eq(paymentRequestLogs.paymentRequestId, requestId))
      .orderBy(asc(paymentRequestLogs.createdAt));
    return rows as Row[];
  }

  /* ================================================================== */
  /*  READ: очереди (site-scope через getUserSiteIds)                    */
  /* ================================================================== */

  private async pendingList(
    userId: string,
    requestIds: string[],
    allSites: boolean,
    userSiteIds: string[],
  ): Promise<Row[]> {
    void userId;
    if (requestIds.length === 0 || (!allSites && userSiteIds.length === 0)) return [];
    const conds = [
      inArray(paymentRequests.id, requestIds),
      eq(paymentRequests.isDeleted, false),
      isNull(paymentRequests.withdrawnAt),
      // Заявки на доработке из очереди согласования исключаем: pending-решение «припарковано»,
      // но согласовывать нельзя до завершения доработки.
      isNull(paymentRequests.previousStatusId),
    ];
    if (!allSites) conds.push(inArray(paymentRequests.siteId, userSiteIds));
    return (await joinedPaymentRequests(this.db)
      .where(and(...conds))
      .orderBy(desc(paymentRequests.createdAt))) as Row[];
  }

  async listPendingByDepartment(opts: {
    userId: string;
    department: string;
    isAdmin: boolean;
  }): Promise<Row[]> {
    const { allSites, siteIds } = await this.getUserSiteIds(opts.userId);
    const requestIds = await this.pendingRequestIds(opts.userId, opts.department, opts.isAdmin);
    return this.pendingList(opts.userId, requestIds, allSites, siteIds);
  }

  async listOmtsRpPending(opts: { userId: string }): Promise<Row[]> {
    const { allSites, siteIds } = await this.getUserSiteIds(opts.userId);
    const rows = await this.db
      .select({ prId: approvalDecisions.paymentRequestId })
      .from(approvalDecisions)
      .where(
        and(
          eq(approvalDecisions.departmentId, 'omts'),
          eq(approvalDecisions.status, 'pending'),
          eq(approvalDecisions.isOmtsRp, true),
        ),
      );
    const requestIds = [...new Set(rows.map((r) => r.prId))];
    return this.pendingList(opts.userId, requestIds, allSites, siteIds);
  }

  async listApproved(opts: { userId: string }): Promise<{ data: Row[]; total: number }> {
    const { allSites, siteIds } = await this.getUserSiteIds(opts.userId);
    if (!allSites && siteIds.length === 0) return { data: [], total: 0 };
    const conds = [isNotNull(paymentRequests.approvedAt), eq(paymentRequests.isDeleted, false)];
    if (!allSites) conds.push(inArray(paymentRequests.siteId, siteIds));
    const data = (await joinedPaymentRequests(this.db)
      .where(and(...conds))
      .orderBy(desc(paymentRequests.approvedAt))) as Row[];
    return { data, total: data.length };
  }

  async listRejected(opts: { userId: string }): Promise<{ data: Row[]; total: number }> {
    const { allSites, siteIds } = await this.getUserSiteIds(opts.userId);
    if (!allSites && siteIds.length === 0) return { data: [], total: 0 };
    const conds = [isNotNull(paymentRequests.rejectedAt), eq(paymentRequests.isDeleted, false)];
    if (!allSites) conds.push(inArray(paymentRequests.siteId, siteIds));
    const data = (await joinedPaymentRequests(this.db)
      .where(and(...conds))
      .orderBy(desc(paymentRequests.rejectedAt))) as Row[];
    return { data, total: data.length };
  }

  /* ================================================================== */
  /*  READ: массивы (site-scope из query)                               */
  /* ================================================================== */

  async listApprovedArray(opts: QueryScope): Promise<Row[]> {
    if (!opts.allSites && opts.siteIds.length === 0) return [];
    const conds = [isNotNull(paymentRequests.approvedAt)];
    if (!opts.showDeleted) conds.push(eq(paymentRequests.isDeleted, false));
    if (!opts.allSites) conds.push(inArray(paymentRequests.siteId, opts.siteIds));
    return (await joinedPaymentRequests(this.db)
      .where(and(...conds))
      .orderBy(desc(paymentRequests.approvedAt))) as Row[];
  }

  async listRejectedArray(opts: QueryScope): Promise<Row[]> {
    if (!opts.allSites && opts.siteIds.length === 0) return [];
    const conds = [isNotNull(paymentRequests.rejectedAt)];
    if (!opts.showDeleted) conds.push(eq(paymentRequests.isDeleted, false));
    if (!opts.allSites) conds.push(inArray(paymentRequests.siteId, opts.siteIds));
    return (await joinedPaymentRequests(this.db)
      .where(and(...conds))
      .orderBy(desc(paymentRequests.rejectedAt))) as Row[];
  }

  /* ================================================================== */
  /*  READ: счётчики                                                    */
  /* ================================================================== */

  private async countWhere(conds: ReturnType<typeof eq>[]): Promise<number> {
    const [r] = await this.db
      .select({ c: count() })
      .from(paymentRequests)
      .where(and(...conds));
    return Number(r?.c ?? 0);
  }

  async countApproved(opts: QueryScope): Promise<number> {
    if (!opts.allSites && opts.siteIds.length === 0) return 0;
    const conds = [isNotNull(paymentRequests.approvedAt)];
    if (!opts.showDeleted) conds.push(eq(paymentRequests.isDeleted, false));
    if (!opts.allSites) conds.push(inArray(paymentRequests.siteId, opts.siteIds));
    return this.countWhere(conds);
  }

  async countRejected(opts: QueryScope): Promise<number> {
    if (!opts.allSites && opts.siteIds.length === 0) return 0;
    const conds = [isNotNull(paymentRequests.rejectedAt)];
    if (!opts.showDeleted) conds.push(eq(paymentRequests.isDeleted, false));
    if (!opts.allSites) conds.push(inArray(paymentRequests.siteId, opts.siteIds));
    return this.countWhere(conds);
  }

  async countAll(opts: QueryScope): Promise<number> {
    if (!opts.allSites && opts.siteIds.length === 0) return 0;
    const conds = [eq(paymentRequests.isDeleted, false)];
    if (!opts.allSites) conds.push(inArray(paymentRequests.siteId, opts.siteIds));
    return this.countWhere(conds);
  }

  async countPendingByDepartment(opts: {
    userId: string;
    department: string;
    isAdmin: boolean;
  }): Promise<number> {
    const { allSites, siteIds } = await this.getUserSiteIds(opts.userId);
    const requestIds = await this.pendingRequestIds(opts.userId, opts.department, opts.isAdmin);
    if (requestIds.length === 0 || (!allSites && siteIds.length === 0)) return 0;
    const conds = [
      inArray(paymentRequests.id, requestIds),
      eq(paymentRequests.isDeleted, false),
      isNull(paymentRequests.withdrawnAt),
      // Счётчик вкладки согласуем с очередью: заявки на доработке не считаем.
      isNull(paymentRequests.previousStatusId),
    ];
    if (!allSites) conds.push(inArray(paymentRequests.siteId, siteIds));
    return this.countWhere(conds);
  }

  async countUnassignedSpecialists(opts: { userId: string }): Promise<number> {
    const { allSites, siteIds } = await this.getUserSiteIds(opts.userId);
    if (!allSites && siteIds.length === 0) return 0;
    const conds = [
      eq(paymentRequests.isDeleted, false),
      isNull(paymentRequests.withdrawnAt),
      isNotNull(paymentRequests.currentStage),
    ];
    if (!allSites) conds.push(inArray(paymentRequests.siteId, siteIds));
    const active = await this.db
      .select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(and(...conds));
    if (active.length === 0) return 0;

    const assigned = await this.db
      .select({ prId: paymentRequestAssignments.paymentRequestId })
      .from(paymentRequestAssignments)
      .where(eq(paymentRequestAssignments.isCurrent, true));
    const assignedSet = new Set(assigned.map((a) => a.prId));
    return active.filter((r) => !assignedSet.has(r.id)).length;
  }

  async countOmtsRp(opts: { userId: string }): Promise<number> {
    const { allSites, siteIds } = await this.getUserSiteIds(opts.userId);
    const rows = await this.db
      .select({ prId: approvalDecisions.paymentRequestId })
      .from(approvalDecisions)
      .where(
        and(
          eq(approvalDecisions.departmentId, 'omts'),
          eq(approvalDecisions.status, 'pending'),
          eq(approvalDecisions.isOmtsRp, true),
        ),
      );
    const requestIds = [...new Set(rows.map((r) => r.prId))];
    if (requestIds.length === 0 || (!allSites && siteIds.length === 0)) return 0;
    const conds = [
      inArray(paymentRequests.id, requestIds),
      eq(paymentRequests.isDeleted, false),
      isNull(paymentRequests.withdrawnAt),
    ];
    if (!allSites) conds.push(inArray(paymentRequests.siteId, siteIds));
    return this.countWhere(conds);
  }

  async countReadyForClosure(opts: { userId: string }): Promise<number> {
    const { allSites, siteIds } = await this.getUserSiteIds(opts.userId);
    if (!allSites && siteIds.length === 0) return 0;
    const conds = [
      isNotNull(paymentRequests.approvedAt),
      isNull(paymentRequests.closedAt),
      eq(paymentRequests.isDeleted, false),
    ];
    if (!allSites) conds.push(inArray(paymentRequests.siteId, siteIds));
    return this.countWhere(conds);
  }

  /* ================================================================== */
  /*  WRITE: машина состояний                                           */
  /* ================================================================== */

  async decide(input: ApprovalDecideInput): Promise<ApprovalDecideResult> {
    // Подготовительные чтения + диспетчеризация (без транзакции — как в Supabase до делегирования).
    const [pr] = await this.db
      .select({
        currentStage: paymentRequests.currentStage,
        siteId: paymentRequests.siteId,
        withdrawnAt: paymentRequests.withdrawnAt,
        statusId: paymentRequests.statusId,
        supplierId: paymentRequests.supplierId,
        previousStatusId: paymentRequests.previousStatusId,
      })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, input.paymentRequestId))
      .limit(1);
    if (!pr) return { ok: false, status: 404, error: 'Заявка не найдена' };
    if (pr.withdrawnAt) {
      return { ok: false, status: 400, error: 'Невозможно обработать отозванную заявку' };
    }

    const currentStage = pr.currentStage as number;
    const siteId = pr.siteId;

    if (input.action === 'approve') {
      // Заявку на доработке нельзя согласовать: сперва «Доработано» вернёт её на прежнюю стадию,
      // где pending-решение ещё существует (иначе гонка расходует pending, а статус «воскресает»).
      if (pr.previousStatusId) {
        return {
          ok: false,
          status: 409,
          error: 'Заявка находится на доработке — сначала завершите доработку',
        };
      }
      if (pr.supplierId) {
        const [sup] = await this.db
          .select({ s: suppliers.lastSecurityStatus })
          .from(suppliers)
          .where(eq(suppliers.id, pr.supplierId))
          .limit(1);
        if (sup?.s === 'rejected') {
          return {
            ok: false,
            status: 403,
            error: 'Поставщик отклонён службой безопасности — согласование невозможно',
          };
        }
      }
      return this.approve(input, currentStage, siteId);
    }

    const code = await this.statusCodeById(this.db, pr.statusId);
    if (code === 'rejected') return { ok: false, status: 400, error: 'Заявка уже отклонена' };
    if (code === 'approved') {
      return { ok: false, status: 400, error: 'Нельзя отклонить согласованную заявку' };
    }
    return this.reject(input, currentStage);
  }

  private async approve(
    input: ApprovalDecideInput,
    currentStage: number,
    siteId: string,
  ): Promise<ApprovalDecideResult> {
    // Финальная ветка может потребовать уведомление — отправляем ПОСЛЕ коммита (best-effort).
    let notify: { creatorId: string; label: string } | null = null;

    const result = await this.db.transaction(async (tx) => {
      const userInfo = await this.getUserInfo(tx, input.userId);

      const [pending] = await tx
        .select({ id: approvalDecisions.id, isOmtsRp: approvalDecisions.isOmtsRp })
        .from(approvalDecisions)
        .where(
          and(
            eq(approvalDecisions.paymentRequestId, input.paymentRequestId),
            eq(approvalDecisions.stageOrder, currentStage),
            eq(approvalDecisions.departmentId, input.department as Department),
            eq(approvalDecisions.status, 'pending'),
          ),
        )
        .limit(1);
      if (!pending) return { ok: false as const, status: 404, error: 'Решение не найдено' };

      const decisionUpdate: Record<string, unknown> = {
        status: 'approved',
        userId: input.userId,
        decidedAt: nowIso(),
      };
      if (input.comment !== undefined) decisionUpdate.comment = input.comment;
      await tx
        .update(approvalDecisions)
        .set(decisionUpdate)
        .where(eq(approvalDecisions.id, pending.id));

      const isCurrentOmtsRp = pending.isOmtsRp;
      await this.appendHistory(tx, input.paymentRequestId, {
        stage: currentStage,
        department: input.department,
        event: 'approved',
        userEmail: userInfo.email,
        userFullName: userInfo.fullName,
        ...(isCurrentOmtsRp ? { isOmtsRp: true } : {}),
      });

      if (currentStage === 1) {
        await tx.insert(approvalDecisions).values({
          paymentRequestId: input.paymentRequestId,
          stageOrder: 2,
          departmentId: 'omts',
          status: 'pending',
          isOmtsRp: false,
        });
        await this.appendHistory(tx, input.paymentRequestId, {
          stage: 2,
          department: 'omts',
          event: 'received',
        });
        const omtsStatusId = await this.statusIdByCode(tx, 'payment_request', 'approv_omts');
        await tx
          .update(paymentRequests)
          .set({
            currentStage: 2,
            statusId: omtsStatusId,
            omtsEnteredAt: nowIso(),
            previousStatusId: null,
          })
          .where(eq(paymentRequests.id, input.paymentRequestId));
      } else if (currentStage === 2) {
        const [settingsRow] = await tx
          .select({ value: settings.value })
          .from(settings)
          .where(eq(settings.key, 'omts_rp_sites'))
          .limit(1);
        const omtsRpSiteIds = ((settingsRow?.value as Row)?.site_ids as string[]) ?? [];
        const needsOmtsRp = omtsRpSiteIds.includes(siteId);

        if (!isCurrentOmtsRp && needsOmtsRp) {
          await tx.insert(approvalDecisions).values({
            paymentRequestId: input.paymentRequestId,
            stageOrder: 2,
            departmentId: 'omts',
            status: 'pending',
            isOmtsRp: true,
          });
          await this.appendHistory(tx, input.paymentRequestId, {
            stage: 2,
            department: 'omts',
            event: 'received',
            isOmtsRp: true,
          });
          const rpStatusId = await this.statusIdByCode(tx, 'payment_request', 'approv_omts_rp');
          await tx
            .update(paymentRequests)
            .set({ statusId: rpStatusId, omtsApprovedAt: nowIso(), previousStatusId: null })
            .where(eq(paymentRequests.id, input.paymentRequestId));
        } else {
          const approvedStatusId = await this.statusIdByCode(tx, 'payment_request', 'approved');
          await tx
            .update(paymentRequests)
            .set({
              statusId: approvedStatusId,
              currentStage: null,
              approvedAt: nowIso(),
              omtsApprovedAt: nowIso(),
              previousStatusId: null,
            })
            .where(eq(paymentRequests.id, input.paymentRequestId));

          const [creatorRow] = await tx
            .select({ createdBy: paymentRequests.createdBy })
            .from(paymentRequests)
            .where(eq(paymentRequests.id, input.paymentRequestId))
            .limit(1);
          const creatorId = creatorRow?.createdBy ?? null;
          if (creatorId && creatorId !== input.userId) {
            const [reqRow] = await tx
              .select({ requestNumber: paymentRequests.requestNumber })
              .from(paymentRequests)
              .where(eq(paymentRequests.id, input.paymentRequestId))
              .limit(1);
            const label = reqRow?.requestNumber ? ` N${reqRow.requestNumber}` : '';
            notify = { creatorId, label };
          }
        }
      }

      return { ok: true as const };
    });

    // Уведомление создателю — после коммита, best-effort (как fire-and-forget в Supabase).
    if (result.ok && notify) {
      const n = notify as { creatorId: string; label: string };
      this.db
        .insert(notifications)
        .values({
          userId: n.creatorId,
          type: 'status_changed',
          title: 'Заявка согласована',
          message: `Заявка${n.label} согласована`,
          paymentRequestId: input.paymentRequestId,
        })
        .then(
          () => {},
          () => {},
        );
    }

    return result;
  }

  private async reject(
    input: ApprovalDecideInput,
    currentStage: number,
  ): Promise<ApprovalDecideResult> {
    return this.db.transaction(async (tx) => {
      const userInfo = await this.getUserInfo(tx, input.userId);

      const [pendingDecision] = await tx
        .select({
          id: approvalDecisions.id,
          stageOrder: approvalDecisions.stageOrder,
          departmentId: approvalDecisions.departmentId,
        })
        .from(approvalDecisions)
        .where(
          and(
            eq(approvalDecisions.paymentRequestId, input.paymentRequestId),
            eq(approvalDecisions.stageOrder, currentStage),
            eq(approvalDecisions.departmentId, input.department as Department),
            eq(approvalDecisions.status, 'pending'),
          ),
        )
        .limit(1);

      let decisionId: string | null = null;
      let effectiveStage: number | null = currentStage ?? null;
      let effectiveDepartment: string = input.department;

      const rejectPatch = (): Record<string, unknown> => {
        const p: Record<string, unknown> = {
          status: 'rejected',
          userId: input.userId,
          decidedAt: nowIso(),
        };
        if (input.comment !== undefined) p.comment = input.comment;
        return p;
      };

      if (pendingDecision) {
        const [upd] = await tx
          .update(approvalDecisions)
          .set(rejectPatch())
          .where(eq(approvalDecisions.id, pendingDecision.id))
          .returning({ id: approvalDecisions.id });
        decisionId = upd!.id;
      } else {
        if (!input.isAdmin) return { ok: false as const, status: 404, error: 'Решение не найдено' };

        const pendingListRows = await tx
          .select({
            id: approvalDecisions.id,
            stageOrder: approvalDecisions.stageOrder,
            departmentId: approvalDecisions.departmentId,
          })
          .from(approvalDecisions)
          .where(
            and(
              eq(approvalDecisions.paymentRequestId, input.paymentRequestId),
              eq(approvalDecisions.status, 'pending'),
            ),
          );
        if (pendingListRows.length > 0) {
          await tx
            .update(approvalDecisions)
            .set(rejectPatch())
            .where(
              and(
                eq(approvalDecisions.paymentRequestId, input.paymentRequestId),
                eq(approvalDecisions.status, 'pending'),
              ),
            );
          decisionId = pendingListRows[0]!.id;
          effectiveStage = pendingListRows[0]!.stageOrder ?? effectiveStage;
          effectiveDepartment = pendingListRows[0]!.departmentId ?? effectiveDepartment;
        } else {
          const [lastDec] = await tx
            .select({
              id: approvalDecisions.id,
              stageOrder: approvalDecisions.stageOrder,
              departmentId: approvalDecisions.departmentId,
            })
            .from(approvalDecisions)
            .where(eq(approvalDecisions.paymentRequestId, input.paymentRequestId))
            .orderBy(desc(approvalDecisions.stageOrder))
            .limit(1);
          if (lastDec) {
            decisionId = lastDec.id;
            effectiveStage = lastDec.stageOrder ?? effectiveStage;
            effectiveDepartment = lastDec.departmentId ?? effectiveDepartment;
          }
        }
      }

      const rejectedStatusId = await this.statusIdByCode(tx, 'payment_request', 'rejected');
      await tx
        .update(paymentRequests)
        .set({
          statusId: rejectedStatusId,
          rejectedStage: effectiveStage,
          currentStage: null,
          rejectedAt: nowIso(),
          previousStatusId: null,
        })
        .where(eq(paymentRequests.id, input.paymentRequestId));

      const [prRow] = await tx
        .select({ requestNumber: paymentRequests.requestNumber })
        .from(paymentRequests)
        .where(eq(paymentRequests.id, input.paymentRequestId))
        .limit(1);

      await this.appendHistory(tx, input.paymentRequestId, {
        stage: effectiveStage ?? currentStage,
        department: effectiveDepartment,
        event: 'rejected',
        userEmail: userInfo.email,
        userFullName: userInfo.fullName,
        comment: input.comment || undefined,
      });

      return {
        ok: true as const,
        decisionId,
        requestNumber: prRow?.requestNumber ?? '',
      };
    });
  }

  async sendToRevision(
    paymentRequestId: string,
    userId: string,
    comment: string,
  ): Promise<ApprovalOpResult> {
    return this.db.transaction(async (tx) => {
      const revisionStatusId = await this.statusIdByCode(tx, 'payment_request', 'revision');
      const [cur] = await tx
        .select({
          statusId: paymentRequests.statusId,
          currentStage: paymentRequests.currentStage,
          approvedAt: paymentRequests.approvedAt,
        })
        .from(paymentRequests)
        .where(eq(paymentRequests.id, paymentRequestId))
        .limit(1);
      if (!cur) return { ok: false as const, status: 404, error: 'Заявка не найдена' };

      const code = await this.statusCodeById(tx, cur.statusId);
      if (code === 'rejected') {
        return {
          ok: false as const,
          status: 400,
          error: 'Нельзя отправить на доработку отклонённую заявку',
        };
      }

      const updateData: Record<string, unknown> = {
        statusId: revisionStatusId,
        previousStatusId: cur.statusId,
      };
      if (cur.approvedAt) updateData.approvedAt = null;
      await tx
        .update(paymentRequests)
        .set(updateData)
        .where(eq(paymentRequests.id, paymentRequestId));

      const userInfo = await this.getUserInfo(tx, userId);
      await tx.insert(paymentRequestLogs).values({
        paymentRequestId,
        userId,
        action: 'revision',
        details: comment ? { comment } : null,
      });
      await this.appendHistory(tx, paymentRequestId, {
        stage: cur.currentStage ?? 2,
        department: 'omts',
        event: 'revision',
        userEmail: userInfo.email,
        userFullName: userInfo.fullName,
        comment: comment || undefined,
      });

      return { ok: true as const };
    });
  }

  async completeRevision(
    paymentRequestId: string,
    userId: string,
    fieldUpdates: ApprovalFieldUpdates,
  ): Promise<ApprovalOpResult> {
    return this.db.transaction(async (tx) => {
      const [cur] = await tx
        .select({
          statusId: paymentRequests.statusId,
          previousStatusId: paymentRequests.previousStatusId,
          currentStage: paymentRequests.currentStage,
          invoiceAmount: paymentRequests.invoiceAmount,
          invoiceAmountHistory: paymentRequests.invoiceAmountHistory,
          supplierId: paymentRequests.supplierId,
          requestType: paymentRequests.requestType,
        })
        .from(paymentRequests)
        .where(eq(paymentRequests.id, paymentRequestId))
        .limit(1);
      if (!cur) return { ok: false as const, status: 404, error: 'Заявка не найдена' };
      if (!cur.previousStatusId) {
        return { ok: false as const, status: 400, error: 'Нет предыдущего статуса' };
      }

      const curCode = await this.statusCodeById(tx, cur.statusId);
      if (curCode === 'rejected') {
        return {
          ok: false as const,
          status: 400,
          error: 'Нельзя завершить доработку на отклонённой заявке',
        };
      }
      const prevCode = await this.statusCodeById(tx, cur.previousStatusId);
      if (prevCode === 'rejected') {
        return {
          ok: false as const,
          status: 400,
          error: 'Нельзя вернуть заявку в статус отклонения',
        };
      }
      const wasApproved = prevCode === 'approved';
      // Заявка была отправлена на доработку из финального статуса «Согласована». Возвращаем её
      // не в approved (иначе она согласуется без нового решения approver'а), а на ПОВТОРНОЕ
      // согласование ОМТС. Авто-типы (contractor_work/own_purchase) создаются сразу approved без
      // цепочки согласования — им пересогласовывать нечего, сохраняем восстановление approved.
      const reopenOmts = wasApproved && cur.requestType === 'contractor';

      // Финальный шлюз ОМТС: если заявка была согласована на под-стадии ОМТС-РП — возвращаем на неё
      // (определяем по наличию approved-решения ОМТС с is_omts_rp=true), иначе в обычное ОМТС.
      let reopenIsOmtsRp = false;
      if (reopenOmts) {
        const [rpApproved] = await tx
          .select({ id: approvalDecisions.id })
          .from(approvalDecisions)
          .where(
            and(
              eq(approvalDecisions.paymentRequestId, paymentRequestId),
              eq(approvalDecisions.stageOrder, 2),
              eq(approvalDecisions.departmentId, 'omts'),
              eq(approvalDecisions.status, 'approved'),
              eq(approvalDecisions.isOmtsRp, true),
            ),
          )
          .limit(1);
        reopenIsOmtsRp = !!rpApproved;
      }

      const updateData: Record<string, unknown> = {
        previousStatusId: null,
        deliveryDays: fieldUpdates.deliveryDays,
        deliveryDaysType: fieldUpdates.deliveryDaysType,
        shippingConditionId: fieldUpdates.shippingConditionId,
        invoiceAmount: fieldUpdates.invoiceAmount ?? null,
        withdrawnAt: null,
        withdrawalComment: null,
      };
      if (reopenOmts) {
        updateData.statusId = await this.statusIdByCode(
          tx,
          'payment_request',
          reopenIsOmtsRp ? 'approv_omts_rp' : 'approv_omts',
        );
        updateData.currentStage = 2;
        updateData.approvedAt = null;
        if (!reopenIsOmtsRp) {
          // Возврат в обычное ОМТС: снимаем ОМТС-согласование и перезапускаем «Срок ОМТС».
          updateData.omtsApprovedAt = null;
          updateData.omtsEnteredAt = nowIso();
        }
        // При ОМТС-РП обычное ОМТС уже согласовано ранее — omts_approved_at/omts_entered_at не трогаем.
      } else {
        updateData.statusId = cur.previousStatusId;
        if (wasApproved) updateData.approvedAt = nowIso();
      }
      // Исходный роут (PostgREST) сравнивал строку "200.00" с числом 200 — строгое !== ВСЕГДА
      // истинно при non-null, т.е. старая сумма архивируется при КАЖДОМ завершении доработки с
      // заданной суммой (в т.ч. без её изменения). Сохраняем ровно это поведение: numeric теперь
      // читается числом (mode:'number'), поэтому «всегда при non-null» задаём условие явно.
      if (cur.invoiceAmount != null) {
        const history = ((cur.invoiceAmountHistory as Row[]) ?? []).slice();
        history.push({ amount: cur.invoiceAmount, changedAt: nowIso() });
        updateData.invoiceAmountHistory = history;
      }

      const supplierProvided = fieldUpdates.supplierId !== undefined;
      const newSupplierId = (fieldUpdates.supplierId ?? null) as string | null;
      const oldSupplierId = (cur.supplierId ?? null) as string | null;
      const supplierChanged = supplierProvided && newSupplierId !== oldSupplierId;
      if (supplierProvided) updateData.supplierId = newSupplierId;

      await tx
        .update(paymentRequests)
        .set(updateData)
        .where(eq(paymentRequests.id, paymentRequestId));

      const userInfo = await this.getUserInfo(tx, userId);

      if (supplierChanged) {
        const ids = [oldSupplierId, newSupplierId].filter(Boolean) as string[];
        let oldName: string | null = null,
          oldInn: string | null = null,
          newName: string | null = null,
          newInn: string | null = null;
        if (ids.length > 0) {
          const sup = await tx
            .select({ id: suppliers.id, name: suppliers.name, inn: suppliers.inn })
            .from(suppliers)
            .where(inArray(suppliers.id, ids));
          const map = new Map<string, { name?: string | null; inn?: string | null }>();
          sup.forEach((s) => map.set(s.id, { name: s.name, inn: s.inn }));
          if (oldSupplierId) {
            oldName = map.get(oldSupplierId)?.name ?? null;
            oldInn = map.get(oldSupplierId)?.inn ?? null;
          }
          if (newSupplierId) {
            newName = map.get(newSupplierId)?.name ?? null;
            newInn = map.get(newSupplierId)?.inn ?? null;
          }
        }
        await tx.insert(paymentRequestLogs).values({
          paymentRequestId,
          userId,
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

      await tx.insert(paymentRequestLogs).values({
        paymentRequestId,
        userId,
        action: 'revision_complete',
        details: null,
      });
      await this.appendHistory(tx, paymentRequestId, {
        stage: cur.currentStage ?? 2,
        department: 'omts',
        event: 'revision_complete',
        userEmail: userInfo.email,
        userFullName: userInfo.fullName,
        ...(supplierChanged ? { supplierChanged: true } : {}),
      });

      // Возврат на повторное согласование: создаём pending-строку ОМТС (очередь строится из
      // approval_decisions), фиксируем «получено». onConflictDoNothing — защита от двойного клика.
      if (reopenOmts) {
        const inserted = await tx
          .insert(approvalDecisions)
          .values({
            paymentRequestId,
            stageOrder: 2,
            departmentId: 'omts',
            status: 'pending',
            isOmtsRp: reopenIsOmtsRp,
          })
          .onConflictDoNothing()
          .returning({ id: approvalDecisions.id });
        if (inserted.length > 0) {
          await this.appendHistory(tx, paymentRequestId, {
            stage: 2,
            department: 'omts',
            event: 'received',
            ...(reopenIsOmtsRp ? { isOmtsRp: true } : {}),
          });
        }
      }

      return { ok: true as const };
    });
  }

  async appendStageHistory(paymentRequestId: string, entry: Row): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.appendHistory(tx, paymentRequestId, entry);
    });
  }

  async createDecisionOnly(input: ApprovalDecideInput): Promise<ApprovalCreateDecisionResult> {
    return this.db.transaction(async (tx) => {
      const [pr] = await tx
        .select({
          currentStage: paymentRequests.currentStage,
          withdrawnAt: paymentRequests.withdrawnAt,
        })
        .from(paymentRequests)
        .where(eq(paymentRequests.id, input.paymentRequestId))
        .limit(1);
      if (!pr) return { ok: false as const, status: 404, error: 'Заявка не найдена' };
      if (pr.withdrawnAt) {
        return {
          ok: false as const,
          status: 400,
          error: 'Невозможно обработать отозванную заявку',
        };
      }

      const decisionUpdate: Record<string, unknown> = {
        status: input.action === 'approve' ? 'approved' : 'rejected',
        userId: input.userId,
        decidedAt: nowIso(),
      };
      if (input.comment !== undefined) decisionUpdate.comment = input.comment;

      const updated = await tx
        .update(approvalDecisions)
        .set(decisionUpdate)
        .where(
          and(
            eq(approvalDecisions.paymentRequestId, input.paymentRequestId),
            eq(approvalDecisions.stageOrder, pr.currentStage as number),
            eq(approvalDecisions.departmentId, input.department as Department),
            eq(approvalDecisions.status, 'pending'),
          ),
        )
        .returning({ id: approvalDecisions.id });
      if (updated.length === 0)
        return { ok: false as const, status: 404, error: 'Решение не найдено' };

      return { ok: true as const, decisionId: updated[0]!.id };
    });
  }

  /* ================================================================== */
  /*  WRITE: файлы решений                                              */
  /* ================================================================== */

  async addDecisionFile(file: AddDecisionFileInput): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(approvalDecisionFiles)
        .values({
          approvalDecisionId: file.approvalDecisionId,
          fileName: file.fileName,
          fileKey: file.fileKey,
          fileSize: file.fileSize,
          mimeType: file.mimeType,
          createdBy: file.createdBy,
        })
        .returning({ id: approvalDecisionFiles.id });
      return { id: inserted!.id };
    });
  }

  async deleteDecisionFile(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(approvalDecisionFiles).where(eq(approvalDecisionFiles.id, id));
    });
  }
}
