/**
 * delta-replay-yandex-to-supabase — rollback-инструмент Сценария B/C (ADR-0006).
 *
 * Если после DNS-switch на новой инфре (Yandex PG) успели пройти write-операции, а затем принят
 * rollback на Supabase — этот скрипт применяет дельту обратно в Supabase:
 *   - читает строки таблиц Yandex PG с `updated_at > T_dns_switch` (мутабельные) или
 *     `created_at > T_dns_switch` (append-only);
 *   - применяет каждую запись в Supabase через @supabase/supabase-js (impl сохранён по принципу 2);
 *   - конфликты (одинаковый PK уже есть в Supabase) — НЕ перезаписывает, а логирует в
 *     delta-replay-conflicts.log для ручного разрешения;
 *   - транзиентные ошибки (timeout/сеть) — ретраит с экспоненциальной задержкой.
 *
 * ВАЖНО (принцип 2): это ЯВНЫЙ операционный скрипт, НЕ runtime-механизм. Никакого автоматического
 * fallback в Supabase из работающего сервиса (split-brain). Имя файла зафиксировано в ADR-0006.
 *
 * Чистая логика (replayDelta) отделена от драйверов БД и покрыта unit-тестами (success / conflict /
 * timeout-retry / partial-batch / retry-exhausted).
 */
import path from 'node:path';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/* ------------------------------- Порты ------------------------------------- */

export interface DeltaTableSpec {
  table: string;
  /** Колонка отсечки: updated_at (мутабельные) или created_at (append-only). */
  sinceColumn: 'updated_at' | 'created_at';
  /** PK для конфликт-детекции и логов (по умолчанию 'id'). */
  pk?: string;
}

export type DeltaRow = Record<string, unknown>;

export interface DeltaSourceReader {
  /** Читает строки таблицы с sinceColumn > sinceIso (источник — Yandex PG). */
  readSince(spec: DeltaTableSpec, sinceIso: string): Promise<DeltaRow[]>;
}

/** Итог применения одной строки в Supabase. */
export type ApplyOutcome =
  | { status: 'applied' }
  | { status: 'conflict'; detail?: string }
  | { status: 'error'; retryable: boolean; message: string };

export interface DeltaTargetWriter {
  applyRow(spec: DeltaTableSpec, row: DeltaRow): Promise<ApplyOutcome>;
}

export interface ReplayOptions {
  reader: DeltaSourceReader;
  writer: DeltaTargetWriter;
  tables: DeltaTableSpec[];
  sinceIso: string;
  /** Максимум ретраев на транзиентную ошибку (по умолчанию 3). */
  maxRetries?: number;
  /** Колбэк конфликта (CLI пишет в delta-replay-conflicts.log). */
  onConflict?: (table: string, pk: unknown, detail?: string) => void;
  logger?: (msg: string) => void;
  /** Инъекция задержки бэкоффа (тесты передают no-op). */
  sleep?: (ms: number) => Promise<void>;
}

export interface TableReplayStats {
  table: string;
  read: number;
  applied: number;
  conflicts: number;
  failed: number;
}

export interface ReplayFailure {
  table: string;
  pk: unknown;
  message: string;
}

export interface ReplayResult {
  tables: TableReplayStats[];
  totals: { read: number; applied: number; conflicts: number; failed: number };
  failures: ReplayFailure[];
}

/* ---------------------------- Чистая логика -------------------------------- */

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Применяет дельту по списку таблиц. Конфликты логируются и НЕ перезаписываются; транзиентные
 * ошибки ретраятся с бэкоффом; невосстановимые — фиксируются в failures, обработка продолжается
 * (partial-batch не прерывает остальные строки/таблицы).
 */
export async function replayDelta(opts: ReplayOptions): Promise<ReplayResult> {
  const log = opts.logger ?? (() => {});
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? 3;

  const tables: TableReplayStats[] = [];
  const failures: ReplayFailure[] = [];

  for (const spec of opts.tables) {
    const pkCol = spec.pk ?? 'id';
    const stat: TableReplayStats = {
      table: spec.table,
      read: 0,
      applied: 0,
      conflicts: 0,
      failed: 0,
    };

    let rows: DeltaRow[];
    try {
      rows = await opts.reader.readSince(spec, opts.sinceIso);
    } catch (err) {
      // Не удалось прочитать таблицу-источник — фиксируем как провал таблицы, идём дальше.
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ table: spec.table, pk: null, message: `read failed: ${message}` });
      stat.failed += 1;
      tables.push(stat);
      log(`[${spec.table}] чтение провалено: ${message}`);
      continue;
    }
    stat.read = rows.length;

    for (const row of rows) {
      const pk = row[pkCol];
      let attempt = 0;
      // Цикл ретраев одной строки.
      for (;;) {
        const outcome = await opts.writer.applyRow(spec, row);
        if (outcome.status === 'applied') {
          stat.applied += 1;
          break;
        }
        if (outcome.status === 'conflict') {
          stat.conflicts += 1;
          opts.onConflict?.(spec.table, pk, outcome.detail);
          log(`[${spec.table}] конфликт PK=${String(pk)} — оставлено для ручного разрешения`);
          break;
        }
        // status === 'error'
        if (outcome.retryable && attempt < maxRetries) {
          attempt += 1;
          await sleep(Math.min(100 * 2 ** attempt, 5000));
          continue;
        }
        stat.failed += 1;
        failures.push({ table: spec.table, pk, message: outcome.message });
        log(`[${spec.table}] провал PK=${String(pk)} после ${attempt} ретраев: ${outcome.message}`);
        break;
      }
    }

    log(
      `[${spec.table}] прочитано ${stat.read}, применено ${stat.applied}, конфликтов ${stat.conflicts}, провалов ${stat.failed}`,
    );
    tables.push(stat);
  }

  const totals = tables.reduce(
    (acc, t) => ({
      read: acc.read + t.read,
      applied: acc.applied + t.applied,
      conflicts: acc.conflicts + t.conflicts,
      failed: acc.failed + t.failed,
    }),
    { read: 0, applied: 0, conflicts: 0, failed: 0 },
  );

  return { tables, totals, failures };
}

/* --------------------------- Драйверы БД ----------------------------------- */

/** Источник — Yandex PG (postgres.js). Читает строки таблицы с отсечкой по времени. */
export class PgDeltaSourceReader implements DeltaSourceReader {
  private readonly sql: postgres.Sql;
  constructor(url: string) {
    this.sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });
  }

  async readSince(spec: DeltaTableSpec, sinceIso: string): Promise<DeltaRow[]> {
    const rows = await this.sql<DeltaRow[]>`
      SELECT * FROM public.${this.sql(spec.table)}
      WHERE ${this.sql(spec.sinceColumn)} > ${sinceIso}
      ORDER BY ${this.sql(spec.sinceColumn)} ASC
    `;
    return [...rows];
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

/** Назначение — Supabase (PostgREST). insert без upsert: дубликат PK = конфликт (не перезапись). */
export class SupabaseDeltaTargetWriter implements DeltaTargetWriter {
  constructor(private readonly client: SupabaseClient) {}

  async applyRow(spec: DeltaTableSpec, row: DeltaRow): Promise<ApplyOutcome> {
    try {
      const { error } = await this.client.from(spec.table).insert(row);
      if (!error) return { status: 'applied' };
      // 23505 — unique_violation (PK уже существует) → конфликт, ручное разрешение.
      if (error.code === '23505') return { status: 'conflict', detail: error.message };
      // Прочие коды PostgREST — невосстановимые (схема/constraint); ретрай не поможет.
      return {
        status: 'error',
        retryable: false,
        message: `${error.code ?? '?'}: ${error.message}`,
      };
    } catch (err) {
      // Сеть/timeout — транзиентно, имеет смысл ретраить.
      const message = err instanceof Error ? err.message : String(err);
      const retryable = /timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed|network/i.test(
        message,
      );
      return { status: 'error', retryable, message };
    }
  }
}

/* ----------------------- Набор таблиц по умолчанию ------------------------- */

/**
 * Куратор-набор таблиц дельты по умолчанию (переопределяется --tables).
 * append-only → created_at; мутабельные бизнес-сущности → updated_at.
 * Оператор уточняет список под фактическую активность в окне rollback (ADR-0006).
 */
export const DEFAULT_DELTA_TABLES: DeltaTableSpec[] = [
  { table: 'payment_requests', sinceColumn: 'updated_at' },
  { table: 'contract_requests', sinceColumn: 'updated_at' },
  { table: 'approval_decisions', sinceColumn: 'updated_at' },
  { table: 'specifications', sinceColumn: 'updated_at' },
  { table: 'payment_request_files', sinceColumn: 'created_at' },
  { table: 'contract_request_files', sinceColumn: 'created_at' },
  { table: 'payment_request_comments', sinceColumn: 'created_at' },
  { table: 'contract_request_comments', sinceColumn: 'created_at' },
  { table: 'notifications', sinceColumn: 'created_at' },
];

/* ------------------------------- CLI --------------------------------------- */

interface CliArgs {
  sourceUrl?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  since?: string;
  conflictLog: string;
  tables?: DeltaTableSpec[];
}

/** Парсит `--tables payment_requests:updated_at,notifications:created_at`. */
export function parseTablesArg(value: string): DeltaTableSpec[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [table, col] = entry.split(':');
      const sinceColumn: DeltaTableSpec['sinceColumn'] =
        col === 'created_at' ? 'created_at' : 'updated_at';
      return { table: table!, sinceColumn };
    });
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { conflictLog: 'delta-replay-conflicts.log' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--source-url') {
      out.sourceUrl = next;
      i += 1;
    } else if (a === '--supabase-url') {
      out.supabaseUrl = next;
      i += 1;
    } else if (a === '--supabase-key') {
      out.supabaseKey = next;
      i += 1;
    } else if (a === '--since') {
      out.since = next;
      i += 1;
    } else if (a === '--conflict-log') {
      out.conflictLog = next ?? out.conflictLog;
      i += 1;
    } else if (a === '--tables') {
      out.tables = next ? parseTablesArg(next) : undefined;
      i += 1;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sourceUrl || !args.supabaseUrl || !args.supabaseKey || !args.since) {
    console.error(
      'Использование: delta-replay-yandex-to-supabase --source-url <yandex-pg> ' +
        '--supabase-url <url> --supabase-key <service-role> --since <ISO> ' +
        '[--tables t1:updated_at,t2:created_at] [--conflict-log path]',
    );
    process.exit(2);
    return;
  }

  const reader = new PgDeltaSourceReader(args.sourceUrl);
  const writer = new SupabaseDeltaTargetWriter(
    createClient(args.supabaseUrl, args.supabaseKey, { auth: { persistSession: false } }),
  );
  const conflictLog = args.conflictLog;

  try {
    const result = await replayDelta({
      reader,
      writer,
      tables: args.tables ?? DEFAULT_DELTA_TABLES,
      sinceIso: args.since,
      logger: (m) => console.log(m),
      onConflict: (table, pk, detail) => {
        appendFileSync(
          conflictLog,
          `${new Date().toISOString()}\t${table}\tpk=${String(pk)}\t${detail ?? ''}\n`,
        );
      },
    });

    console.log(
      `Итог: прочитано ${result.totals.read}, применено ${result.totals.applied}, ` +
        `конфликтов ${result.totals.conflicts}, провалов ${result.totals.failed}.`,
    );
    if (result.totals.conflicts > 0) {
      console.log(`Конфликты записаны в ${conflictLog} — требуется ручное разрешение.`);
    }
    // Провалы → ненулевой код (конфликты — ожидаемая ситуация, не валят прогон сами по себе).
    process.exit(result.totals.failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('delta-replay провалился:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await reader.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
