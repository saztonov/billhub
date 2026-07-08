/**
 * Хелперы этапов согласования заявок: Штаб (1) → ОМТС (2) → РП (3) → Согласована.
 * Вынесены из approval.drizzle.ts (лимит 600 строк на файл): департаменты этапов,
 * серверная авторизация решений и резолв назначенцев этапа «РП» (rp_stage_assignees).
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { rpStageAssignees } from '../../db/schema/index.js';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

/** Департамент этапа согласования по номеру стадии (фолбэк — ОМТС, как в старом коде). */
export function stageDepartment(stage: number): 'shtab' | 'omts' | 'rp' {
  if (stage === 1) return 'shtab';
  if (stage === 3) return 'rp';
  return 'omts';
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
 * Этап 1 — Штаб, этап 2 — ОМТС, этап 3 — назначенец объекта заявки; админ — любой этап.
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
  if (opts.stage === 1) return opts.userDepartment === 'shtab';
  if (opts.stage === 2) return opts.userDepartment === 'omts';
  if (opts.stage === 3) {
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
