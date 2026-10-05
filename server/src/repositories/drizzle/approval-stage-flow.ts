/**
 * Хелперы этапов согласования заявок:
 * Штаб (1) → ОМТС (2) → УОК (3, сумма счёта свыше порога) → РП (4, назначенец объекта) → Согласована.
 * Вынесены из approval.drizzle.ts (лимит 600 строк на файл): департаменты и статусы этапов,
 * серверная авторизация решений, маршрутизация на следующий этап и резолв назначенцев этапа
 * «РП» (rp_stage_assignees).
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { approvalDecisions, rpStageAssignees } from '../../db/schema/index.js';
import { getUokThreshold, requiresUokStage } from '../../services/uok/uok-threshold-setting.js';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

/** Номера этапов согласования (approval_decisions.stage_order / payment_requests.current_stage). */
export const STAGE_SHTAB = 1;
export const STAGE_OMTS = 2;
export const STAGE_UOK = 3;
export const STAGE_RP = 4;

/** Департамент этапа согласования по номеру стадии (фолбэк — ОМТС, как в старом коде). */
export function stageDepartment(stage: number): 'shtab' | 'omts' | 'uok' | 'rp' {
  if (stage === STAGE_SHTAB) return 'shtab';
  if (stage === STAGE_UOK) return 'uok';
  if (stage === STAGE_RP) return 'rp';
  return 'omts';
}

/** Код статуса заявки «на согласовании» для этапа (резолвится в statuses по code). */
export function stageStatusCode(stage: number): string {
  if (stage === STAGE_SHTAB) return 'approv_shtab';
  if (stage === STAGE_UOK) return 'approv_uok';
  if (stage === STAGE_RP) return 'approv_rp';
  return 'approv_omts';
}

/** Назначенец этапа «РП» по объекту (null — этап РП для объекта не требуется). */
export async function rpAssigneeForSite(db: DbOrTx, siteId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: rpStageAssignees.userId })
    .from(rpStageAssignees)
    .where(eq(rpStageAssignees.constructionSiteId, siteId))
    .limit(1);
  return row?.userId ?? null;
}

/** Объекты, на которые назначен пользователь как согласующий РП. */
export async function rpAssigneeSiteIds(db: DbOrTx, userId: string): Promise<string[]> {
  const rows = await db
    .select({ siteId: rpStageAssignees.constructionSiteId })
    .from(rpStageAssignees)
    .where(eq(rpStageAssignees.userId, userId));
  return rows.map((r) => r.siteId);
}

/**
 * Серверная авторизация решения по этапу: матчинг pending идёт по current_stage
 * (департамент из тела запроса не используется), поэтому право действовать проверяем явно.
 * Этап 1 — Штаб, этап 2 — ОМТС, этап 3 — УОК, этап 4 — назначенец объекта заявки;
 * админ — любой этап.
 */
export async function userMayActOnStage(
  db: DbOrTx,
  opts: {
    stage: number;
    siteId: string;
    userId: string;
    userDepartment: string | null;
    isAdmin: boolean;
  },
): Promise<boolean> {
  if (opts.isAdmin) return true;
  if (opts.stage === STAGE_SHTAB) return opts.userDepartment === 'shtab';
  if (opts.stage === STAGE_OMTS) return opts.userDepartment === 'omts';
  if (opts.stage === STAGE_UOK) return opts.userDepartment === 'uok';
  if (opts.stage === STAGE_RP) {
    const [row] = await db
      .select({ id: rpStageAssignees.id })
      .from(rpStageAssignees)
      .where(
        and(
          eq(rpStageAssignees.constructionSiteId, opts.siteId),
          eq(rpStageAssignees.userId, opts.userId),
        ),
      )
      .limit(1);
    return !!row;
  }
  return false;
}

/** Следующий этап после согласования: УОК или РП (с назначенцем); null — финализация. */
export type NextStage =
  | { stage: typeof STAGE_UOK }
  | { stage: typeof STAGE_RP; assigneeId: string };

/**
 * Маршрут после согласования этапа ОМТС или УОК:
 * с ОМТС — на УОК, если сумма счёта свыше порога; с ОМТС/УОК — на РП, если у объекта есть
 * назначенец; иначе null (финализация). Для остальных этапов — null.
 */
export async function nextStageAfter(
  db: DbOrTx,
  opts: { stage: number; siteId: string; invoiceAmount: number | null },
): Promise<NextStage | null> {
  if (opts.stage === STAGE_OMTS) {
    const threshold = await getUokThreshold(db);
    if (requiresUokStage(opts.invoiceAmount, threshold)) return { stage: STAGE_UOK };
  }
  if (opts.stage === STAGE_OMTS || opts.stage === STAGE_UOK) {
    const assigneeId = await rpAssigneeForSite(db, opts.siteId);
    if (assigneeId) return { stage: STAGE_RP, assigneeId };
  }
  return null;
}

/**
 * Этап повторного согласования ранее согласованной заявки после «Доработано» — последний
 * обязательный рубеж с учётом суммы после доработки:
 *  - РП — если заявка проходила РП (этап 4 либо легаси-под-этап ОМТС-РП), назначенец по объекту
 *    есть сейчас, а УОК по сумме не требуется либо уже согласовал заявку;
 *  - УОК — если сумма свыше порога (в т.ч. сумму подняли при доработке, а УОК заявку не видел);
 *  - иначе ОМТС (дальше — обычная маршрутизация по порогу и назначенцу РП).
 */
export async function reopenStageFor(
  db: DbOrTx,
  opts: { paymentRequestId: string; siteId: string; invoiceAmount: number | null },
): Promise<number> {
  const approved = await db
    .select({ departmentId: approvalDecisions.departmentId, isOmtsRp: approvalDecisions.isOmtsRp })
    .from(approvalDecisions)
    .where(
      and(
        eq(approvalDecisions.paymentRequestId, opts.paymentRequestId),
        eq(approvalDecisions.status, 'approved'),
      ),
    );
  const passedRp = approved.some(
    (d) => d.departmentId === 'rp' || (d.departmentId === 'omts' && d.isOmtsRp),
  );
  const passedUok = approved.some((d) => d.departmentId === 'uok');
  const uokRequired = requiresUokStage(opts.invoiceAmount, await getUokThreshold(db));

  if (passedRp && (!uokRequired || passedUok) && (await rpAssigneeForSite(db, opts.siteId))) {
    return STAGE_RP;
  }
  if (uokRequired) return STAGE_UOK;
  return STAGE_OMTS;
}
