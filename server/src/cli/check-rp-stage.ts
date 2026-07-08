/**
 * check-rp-stage — read-only проверка инвариантов этапа «РП» на боевой БД
 * ПОСЛЕ наката миграций 0015/0016 (`deploy-billhub --migrate`).
 *
 * Проверяет:
 *   1. enum department_enum содержит значение 'rp';
 *   2. таблица rp_stage_assignees существует (и сколько назначений перенесено);
 *   3. статус payment_request/approv_rp существует, approv_omts_rp не остался;
 *   4. не осталось pending-решений легаси-под-этапа (is_omts_rp=true) — все конвертированы;
 *   5. у заявок с pending-решением этапа 3 «РП» current_stage=3 (иначе матчинг по
 *      current_stage их не найдёт — «залипание» класса миграции 0014);
 *   6. у заявок в статусе approv_rp (не на доработке) есть pending-решение этапа 3;
 *   7. у заявок с current_stage=3 есть pending-решение этапа 3.
 *
 * ТОЛЬКО чтение — можно запускать на проде без риска. Exit 0 — все проверки зелёные.
 * Запуск (на VPS): `npm --prefix server run check:rp-stage` (берёт DATABASE_URL).
 */
import postgres from 'postgres';

export interface RpStageCheckRow {
  /** Короткий код проверки. */
  key: string;
  /** Человекочитаемое описание. */
  title: string;
  /** true — проверка пройдена. */
  ok: boolean;
  /** Дополнительная информация (счётчики, номера заявок-нарушителей). */
  detail: string;
}

export interface RpStageRawState {
  enumHasRp: boolean;
  tableExists: boolean;
  assigneesCount: number;
  statusRpExists: boolean;
  statusLegacyExists: boolean;
  legacyPendingCount: number;
  pendingRpWrongStageNumbers: string[];
  statusRpWithoutPendingNumbers: string[];
  stage3WithoutPendingNumbers: string[];
}

/** Чистая оценка сырого состояния БД → список проверок (unit-тестируется без БД). */
export function evaluateRpStageChecks(s: RpStageRawState): RpStageCheckRow[] {
  const list = (nums: string[]): string =>
    nums.length === 0 ? 'нет' : `заявки: ${nums.join(', ')}`;
  return [
    {
      key: 'enum_rp',
      title: "enum department_enum содержит 'rp' (миграция 0015)",
      ok: s.enumHasRp,
      detail: s.enumHasRp ? 'есть' : 'ОТСУТСТВУЕТ',
    },
    {
      key: 'table',
      title: 'таблица rp_stage_assignees существует (миграция 0016)',
      ok: s.tableExists,
      detail: s.tableExists ? `назначений: ${s.assigneesCount}` : 'ОТСУТСТВУЕТ',
    },
    {
      key: 'status_rp',
      title: 'статус payment_request/approv_rp существует',
      ok: s.statusRpExists,
      detail: s.statusRpExists ? 'есть' : 'ОТСУТСТВУЕТ',
    },
    {
      key: 'status_legacy',
      title: 'статус approv_omts_rp переименован (не остался)',
      ok: !s.statusLegacyExists,
      detail: s.statusLegacyExists ? 'СТАРЫЙ КОД ЕЩЁ В БД' : 'переименован',
    },
    {
      key: 'legacy_pending',
      title: 'pending-решения легаси-под-этапа (is_omts_rp=true) конвертированы',
      ok: s.legacyPendingCount === 0,
      detail: s.legacyPendingCount === 0 ? 'не осталось' : `осталось: ${s.legacyPendingCount}`,
    },
    {
      key: 'pending_rp_stage',
      title: 'у pending-решений этапа «РП» current_stage=3 (нет залипания класса 0014)',
      ok: s.pendingRpWrongStageNumbers.length === 0,
      detail: list(s.pendingRpWrongStageNumbers),
    },
    {
      key: 'status_without_pending',
      title: 'у заявок в статусе approv_rp (не на доработке) есть pending этапа 3',
      ok: s.statusRpWithoutPendingNumbers.length === 0,
      detail: list(s.statusRpWithoutPendingNumbers),
    },
    {
      key: 'stage3_without_pending',
      title: 'у заявок с current_stage=3 есть pending этапа 3',
      ok: s.stage3WithoutPendingNumbers.length === 0,
      detail: list(s.stage3WithoutPendingNumbers),
    },
  ];
}

/** Сбор сырого состояния из БД (только SELECT). */
export async function collectRpStageState(sql: postgres.Sql): Promise<RpStageRawState> {
  const [enumRow] = await sql`
    SELECT 1 AS x FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'department_enum' AND e.enumlabel = 'rp'`;

  const [tableRow] = await sql`SELECT to_regclass('public.rp_stage_assignees') AS reg`;
  const tableExists = tableRow?.reg != null;

  const assigneesCount = tableExists
    ? Number((await sql`SELECT count(*)::int AS c FROM public.rp_stage_assignees`)[0]?.c ?? 0)
    : 0;

  const [statusRp] = await sql`
    SELECT 1 AS x FROM public.statuses
    WHERE entity_type = 'payment_request' AND code = 'approv_rp'`;
  const [statusLegacy] = await sql`
    SELECT 1 AS x FROM public.statuses
    WHERE entity_type = 'payment_request' AND code = 'approv_omts_rp'`;

  const [legacyPending] = await sql`
    SELECT count(*)::int AS c FROM public.approval_decisions
    WHERE status = 'pending' AND is_omts_rp = true`;

  // Pending этапа 3 «РП» у заявки, чей current_stage != 3 — решение «не находится» матчингом.
  const wrongStage = await sql`
    SELECT DISTINCT pr.request_number AS n
    FROM public.approval_decisions ad
    JOIN public.payment_requests pr ON pr.id = ad.payment_request_id
    WHERE ad.status = 'pending' AND ad.department_id = 'rp'
      AND pr.current_stage IS DISTINCT FROM 3
    ORDER BY 1`;

  // Статус approv_rp без pending этапа 3 (заявка не на доработке) — кнопка «Согласовать» пропадёт.
  const withoutPending = await sql`
    SELECT pr.request_number AS n
    FROM public.payment_requests pr
    JOIN public.statuses st ON st.id = pr.status_id
    WHERE st.entity_type = 'payment_request' AND st.code = 'approv_rp'
      AND pr.previous_status_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.approval_decisions ad
        WHERE ad.payment_request_id = pr.id
          AND ad.status = 'pending' AND ad.department_id = 'rp'
      )
    ORDER BY 1`;

  const stage3WithoutPending = await sql`
    SELECT pr.request_number AS n
    FROM public.payment_requests pr
    WHERE pr.current_stage = 3
      AND NOT EXISTS (
        SELECT 1 FROM public.approval_decisions ad
        WHERE ad.payment_request_id = pr.id
          AND ad.status = 'pending' AND ad.department_id = 'rp'
      )
    ORDER BY 1`;

  return {
    enumHasRp: !!enumRow,
    tableExists,
    assigneesCount,
    statusRpExists: !!statusRp,
    statusLegacyExists: !!statusLegacy,
    legacyPendingCount: Number(legacyPending?.c ?? 0),
    pendingRpWrongStageNumbers: wrongStage.map((r) => String(r.n)),
    statusRpWithoutPendingNumbers: withoutPending.map((r) => String(r.n)),
    stage3WithoutPendingNumbers: stage3WithoutPending.map((r) => String(r.n)),
  };
}

/** CLI-точка входа. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    console.error('Не задан DATABASE_URL');
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });
  try {
    const state = await collectRpStageState(sql);
    const checks = evaluateRpStageChecks(state);
    console.log('Проверка этапа «РП» (после миграций 0015/0016):');
    for (const c of checks) {
      console.log(`  ${c.ok ? '✓' : '✗'} ${c.title} — ${c.detail}`);
    }
    const failed = checks.filter((c) => !c.ok);
    if (failed.length > 0) {
      console.error(`ПРОВАЛ: ${failed.length} проверок(и) не пройдено.`);
      process.exit(1);
    }
    console.log('OK: все проверки этапа «РП» пройдены.');
    process.exit(0);
  } catch (err) {
    console.error('Ошибка проверки:', err instanceof Error ? err.message : err);
    process.exit(2);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
