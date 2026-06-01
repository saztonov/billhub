/**
 * check-pg-latency — замер latency до Yandex Managed PostgreSQL с целевой VPS (Iteration 8).
 *
 * 100 запросов трёх типов:
 *   - 30 × `SELECT 1`                         (round-trip overhead)
 *   - 30 × PK lookup                          (точечное чтение по индексу)
 *   - 40 × LATERAL join list_counterparties_with_sb (серверная RPC с агрегатами СБ)
 * Считает median и p95 (по всем 100 + по категориям). Exit 1, если median > 30 мс или p95 > 50 мс
 * (план Iteration 8: >30 мс на простой SELECT → пересмотр провайдера VPS).
 *
 * Запуск (на VPS, против Yandex PG): `npm --prefix server run db:latency`
 * или через лаунчер: `npx tsx scripts/check-pg-latency.ts`. Берёт DATABASE_URL.
 *
 * Чистые функции (percentile/summarize/evaluate) — без БД, покрыты unit-тестом; форма скрипта
 * (реальный прогон) — integration-тестом на testcontainers.
 */
import postgres from 'postgres';

export interface LatencyThresholds {
  /** Порог median (мс). */
  medianMs: number;
  /** Порог p95 (мс). */
  p95Ms: number;
}

export const DEFAULT_THRESHOLDS: LatencyThresholds = { medianMs: 30, p95Ms: 50 };

export interface LatencySummary {
  count: number;
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

/** Перцентиль (linear interpolation, nearest-rank-ish) по НЕотсортированному массиву. p ∈ [0,1]. */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

/** Сводка по выборке latency (мс). */
export function summarize(samples: number[]): LatencySummary {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    minMs: sorted[0] ?? Number.NaN,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1] ?? Number.NaN,
  };
}

export interface LatencyVerdict {
  ok: boolean;
  problems: string[];
}

/** Оценка сводки против порогов. ok=false → exit 1. */
export function evaluate(
  summary: LatencySummary,
  thresholds: LatencyThresholds = DEFAULT_THRESHOLDS,
): LatencyVerdict {
  const problems: string[] = [];
  if (summary.medianMs > thresholds.medianMs) {
    problems.push(`median ${summary.medianMs.toFixed(1)} мс > порога ${thresholds.medianMs} мс`);
  }
  if (summary.p95Ms > thresholds.p95Ms) {
    problems.push(`p95 ${summary.p95Ms.toFixed(1)} мс > порога ${thresholds.p95Ms} мс`);
  }
  return { ok: problems.length === 0, problems };
}

/** Тип одного измерения. */
export type ProbeKind = 'select1' | 'pk_lookup' | 'lateral_join';

export interface ProbePlanItem {
  kind: ProbeKind;
  run: (sql: postgres.Sql) => Promise<unknown>;
}

/** Стандартный план: 30 select1 + 30 pk lookup + 40 lateral join = 100. */
export function buildDefaultPlan(): ProbePlanItem[] {
  const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
  const select1: ProbePlanItem = { kind: 'select1', run: (sql) => sql`SELECT 1` };
  const pkLookup: ProbePlanItem = {
    kind: 'pk_lookup',
    run: (sql) => sql`SELECT id FROM public.counterparties WHERE id = ${ZERO_UUID}::uuid`,
  };
  const lateralJoin: ProbePlanItem = {
    kind: 'lateral_join',
    // RPC с внутренним LATERAL join агрегатов СБ (см. schema.sql).
    run: (sql) =>
      sql`SELECT * FROM public.list_counterparties_with_sb('', 'all', 1, 20, CURRENT_DATE)`,
  };
  return [
    ...Array.from({ length: 30 }, () => select1),
    ...Array.from({ length: 30 }, () => pkLookup),
    ...Array.from({ length: 40 }, () => lateralJoin),
  ];
}

export interface ProbeResult {
  overall: LatencySummary;
  byKind: Record<ProbeKind, LatencySummary>;
  samples: { kind: ProbeKind; ms: number }[];
}

/** Высокоточный таймер (мс) — process.hrtime, не Date.now (Date.now запрещён в части харнесса). */
function nowMs(): number {
  const [s, ns] = process.hrtime();
  return s * 1000 + ns / 1e6;
}

/**
 * Прогоняет план измерений по живому соединению. Делает короткий warmup (не учитывается),
 * затем измеряет каждый запрос отдельно. Возвращает сводки.
 */
export async function runProbe(
  sql: postgres.Sql,
  plan: ProbePlanItem[] = buildDefaultPlan(),
): Promise<ProbeResult> {
  // Warmup: прогреваем соединение/планы, эти замеры отбрасываем.
  for (let i = 0; i < 3; i++) await sql`SELECT 1`;

  const samples: { kind: ProbeKind; ms: number }[] = [];
  for (const item of plan) {
    const t0 = nowMs();
    await item.run(sql);
    samples.push({ kind: item.kind, ms: nowMs() - t0 });
  }

  const pick = (k: ProbeKind): number[] => samples.filter((s) => s.kind === k).map((s) => s.ms);

  return {
    overall: summarize(samples.map((s) => s.ms)),
    byKind: {
      select1: summarize(pick('select1')),
      pk_lookup: summarize(pick('pk_lookup')),
      lateral_join: summarize(pick('lateral_join')),
    },
    samples,
  };
}

function fmt(s: LatencySummary): string {
  return `n=${s.count} min=${s.minMs.toFixed(1)} median=${s.medianMs.toFixed(1)} p95=${s.p95Ms.toFixed(1)} max=${s.maxMs.toFixed(1)} (мс)`;
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
    const result = await runProbe(sql);
    console.log('Latency до PostgreSQL:');
    console.log('  overall      :', fmt(result.overall));
    console.log('  select1      :', fmt(result.byKind.select1));
    console.log('  pk_lookup    :', fmt(result.byKind.pk_lookup));
    console.log('  lateral_join :', fmt(result.byKind.lateral_join));
    const verdict = evaluate(result.overall);
    if (!verdict.ok) {
      console.error('ПРОВАЛ порогов (ADR-0005 / план Iteration 8):');
      for (const p of verdict.problems) console.error('  -', p);
      process.exit(1);
    }
    console.log('OK: median ≤ 30 мс и p95 ≤ 50 мс.');
    process.exit(0);
  } catch (err) {
    console.error('Ошибка замера latency:', err instanceof Error ? err.message : err);
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
