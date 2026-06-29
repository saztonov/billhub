/**
 * Migration runner BillHub (SQL-first, ADR-0002 принцип 6).
 *
 * Собственный CLI на postgres.js. Системная таблица `public._migrations`
 * (version int PK, name text, checksum text, applied_at timestamptz).
 *
 * Логика:
 *  - читает sql/migrations/, сортирует по числовому префиксу;
 *  - применяет ещё не применённые миграции, каждую в отдельной транзакции;
 *  - фиксирует SHA-256 checksum файла;
 *  - checksum-несоответствие УЖЕ применённой миграции = ошибка (защита от правки старых миграций).
 *
 * Архитектура bootstrap-схемы (план Iteration 6 примечание, ADR-0003):
 *  - 0000_baseline.sql и 001-007 УДАЛЕНЫ (тег pre-migration-cleanup).
 *  - Bootstrap на чистой Yandex PG = scripts/bootstrap-schema.sh (Iteration 8):
 *    sed-фильтрация sql/schema/schema.sql + psql, потом migrate.js применяет 0001+.
 *  - Если baseline (0000) когда-нибудь вернётся — поддержка директивы
 *    `migrate:baseline-covers-through=N` сохранена (parseCoversThrough), при её отсутствии
 *    coversThrough=-1 и все миграции выполняются нормально.
 *
 * `drizzle-kit migrate`/`generate`/`push` НЕ используются (ADR-0002).
 *
 * Запуск: `npm run db:migrate` (env DATABASE_MIGRATION_URL || DATABASE_URL).
 * В deployment — отдельным контейнером под пользователем billhub_migration.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Каталог SQL-миграций.
 * Приоритет: env `MIGRATIONS_DIR` → относительный путь от модуля (репо-корень/sql/migrations).
 *
 * В собранном образе глубина dist/cli (2 уровня под /app) отличается от исходной server/src/cli
 * (3 уровня под корнем), поэтому относительный `../../../sql/migrations` указывал бы на `/sql/migrations`.
 * В Docker-образе миграции лежат в `/app/sql/migrations`, и путь задаётся через `MIGRATIONS_DIR`
 * (ENV в Dockerfile). Для исходника/тестов/локального запуска работает относительный фоллбэк.
 */
export const DEFAULT_MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ?? path.resolve(__dirname, '../../../sql/migrations');

/** Описание одной миграции на диске. */
export interface MigrationFile {
  version: number;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
}

/** Запись из таблицы _migrations. */
export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
}

/** Действие плана применения. */
export type MigrationAction = 'execute' | 'cover' | 'skip';

export interface PlannedMigration {
  version: number;
  name: string;
  checksum: string;
  sql: string;
  action: MigrationAction;
}

export interface MigrationPlan {
  items: PlannedMigration[];
  toExecute: number;
  toCover: number;
  toSkip: number;
}

export interface RunMigrationsOptions {
  databaseUrl: string;
  migrationsDir?: string;
  logger?: (msg: string) => void;
}

export interface RunMigrationsResult {
  executed: number[];
  covered: number[];
  skipped: number[];
}

/**
 * Ошибка: попытка применить миграции к Supabase-хосту (принцип 1 — старый прод не модифицируется).
 */
export class SupabaseMigrationBlockedError extends Error {
  constructor(public readonly host: string) {
    super(
      `Отказ применять миграции к Supabase-хосту (${host}). Принцип 1: старый прод не модифицируется. ` +
        `Если это осознанное действие на не-прод Supabase — задайте ALLOW_SUPABASE_MIGRATIONS=1.`,
    );
    this.name = 'SupabaseMigrationBlockedError';
  }
}

/** Извлекает hostname из строки подключения PostgreSQL (URL или регэксп-фоллбэк). */
export function extractDbHost(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    const m = /@([^:/?\s]+)/.exec(databaseUrl);
    return (m?.[1] ?? '').toLowerCase();
  }
}

/** Хост принадлежит Supabase (прямое подключение или pooler). */
export function isSupabaseHost(databaseUrl: string): boolean {
  const host = extractDbHost(databaseUrl);
  return /\.supabase\.(co|com)$/i.test(host) || /\.pooler\.supabase\.com$/i.test(host);
}

/**
 * Защита runner-а от применения миграций к Supabase (принцип 1). Бросает, если host —
 * Supabase, кроме явного override ALLOW_SUPABASE_MIGRATIONS=1.
 */
export function assertNotSupabase(databaseUrl: string, env: NodeJS.ProcessEnv = process.env): void {
  if (env.ALLOW_SUPABASE_MIGRATIONS === '1') return;
  if (isSupabaseHost(databaseUrl)) {
    throw new SupabaseMigrationBlockedError(extractDbHost(databaseUrl));
  }
}

/** Ошибка несоответствия checksum уже применённой миграции. */
export class ChecksumMismatchError extends Error {
  constructor(
    public readonly version: number,
    public readonly name: string,
    public readonly applied: string,
    public readonly current: string,
  ) {
    super(
      `Checksum миграции ${String(version).padStart(4, '0')}_${name} изменился после применения ` +
        `(применён ${applied.slice(0, 12)}…, сейчас ${current.slice(0, 12)}…). ` +
        `Запрещено редактировать применённые миграции — создайте новую (ADR-0002).`,
    );
    this.name = 'ChecksumMismatchError';
  }
}

/** SHA-256 hex от содержимого файла (нормализуем CRLF→LF для кросс-платформенной стабильности). */
export function computeChecksum(content: string): string {
  return createHash('sha256').update(content.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/** Числовой префикс имени файла миграции: `0000_baseline.sql` → 0, `006_x.sql` → 6. */
export function parseMigrationVersion(filename: string): number | null {
  const m = /^(\d+)[_.-]/.exec(filename);
  if (!m) return null;
  return Number.parseInt(m[1]!, 10);
}

/** Имя миграции без префикса и расширения: `006_add_x.sql` → `add_x`. */
export function parseMigrationName(filename: string): string {
  return filename.replace(/^\d+[_.-]/, '').replace(/\.sql$/i, '');
}

/** Директива `migrate:baseline-covers-through=N` из baseline. -1, если отсутствует. */
export function parseCoversThrough(baselineContent: string): number {
  const m = /migrate:baseline-covers-through=(\d+)/.exec(baselineContent);
  return m ? Number.parseInt(m[1]!, 10) : -1;
}

/** Прочитать и отсортировать миграции из каталога (по возрастанию version). */
export function loadMigrationFiles(dir: string): MigrationFile[] {
  const files = readdirSync(dir).filter((f) => /\.sql$/i.test(f));
  const out: MigrationFile[] = [];
  for (const filename of files) {
    const version = parseMigrationVersion(filename);
    if (version === null) continue;
    const sql = readFileSync(path.join(dir, filename), 'utf8');
    out.push({
      version,
      name: parseMigrationName(filename),
      filename,
      sql,
      checksum: computeChecksum(sql),
    });
  }
  out.sort((a, b) => a.version - b.version);
  const seen = new Set<number>();
  for (const f of out) {
    if (seen.has(f.version)) {
      throw new Error(`Дублирующийся номер миграции: ${f.version} (${f.filename})`);
    }
    seen.add(f.version);
  }
  return out;
}

/**
 * Ошибка: execute-миграция сама управляет транзакцией.
 * Runner оборачивает каждую execute-миграцию в одну транзакцию (DDL + запись в _migrations).
 * Top-level BEGIN/COMMIT/ROLLBACK в файле зафиксировали бы внешнюю транзакцию преждевременно,
 * нарушив атомарность (DDL применён, но запись в _migrations — нет).
 */
export class TransactionControlError extends Error {
  constructor(
    public readonly version: number,
    public readonly migrationName: string,
  ) {
    super(
      `Миграция ${String(version).padStart(4, '0')}_${migrationName} содержит top-level ` +
        `BEGIN/COMMIT/ROLLBACK. Runner сам оборачивает миграцию в транзакцию — ` +
        `уберите управление транзакцией из файла (конвенция SQL-first runner).`,
    );
    this.name = 'TransactionControlError';
  }
}

/**
 * Есть ли в SQL top-level команды управления транзакцией (вне тел функций $$...$$).
 * PL/pgSQL BEGIN/END внутри dollar-quoted тел НЕ считаются.
 */
export function containsTransactionControl(sql: string): boolean {
  const withoutBodies = sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, '');
  return /(^|\n)\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i.test(withoutBodies);
}

/**
 * Чистая планировочная логика (без БД) — основной объект unit-тестов.
 * Бросает ChecksumMismatchError, если применённая миграция изменилась;
 * TransactionControlError, если execute-миграция сама управляет транзакцией.
 */
export function planMigrations(
  files: MigrationFile[],
  applied: AppliedMigration[],
  coversThrough: number,
): MigrationPlan {
  const appliedMap = new Map(applied.map((a) => [a.version, a]));
  const items: PlannedMigration[] = [];

  for (const f of files) {
    const prev = appliedMap.get(f.version);
    if (prev) {
      if (prev.checksum !== f.checksum) {
        throw new ChecksumMismatchError(f.version, f.name, prev.checksum, f.checksum);
      }
      items.push({ ...f, action: 'skip' });
      continue;
    }
    // Не применена. Baseline-covered версии (> 0 и ≤ coversThrough) помечаем без исполнения.
    const action: MigrationAction =
      f.version > 0 && f.version <= coversThrough ? 'cover' : 'execute';
    // execute-миграция не должна сама управлять транзакцией (runner оборачивает её сам).
    if (action === 'execute' && containsTransactionControl(f.sql)) {
      throw new TransactionControlError(f.version, f.name);
    }
    items.push({ ...f, action });
  }

  return {
    items,
    toExecute: items.filter((i) => i.action === 'execute').length,
    toCover: items.filter((i) => i.action === 'cover').length,
    toSkip: items.filter((i) => i.action === 'skip').length,
  };
}

/** SQL создания системной таблицы версий. */
const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS public._migrations (
    version    integer PRIMARY KEY,
    name       text NOT NULL,
    checksum   text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
`;

/** Стабильный ключ advisory-лока миграций (защита от параллельного наката, в т.ч. с другой машины). */
const MIGRATION_ADVISORY_LOCK_KEY = 7656501;

/** Ошибка: БД доступна только для чтения (standby/read-only) — миграции запрещены. */
export class ReadOnlyDatabaseError extends Error {
  constructor() {
    super(
      'БД доступна только для чтения (standby/replica или transaction_read_only=on). ' +
        'Миграции применяются только к мастеру — проверьте строку подключения.',
    );
    this.name = 'ReadOnlyDatabaseError';
  }
}

/** Ошибка: не удалось получить advisory-лок (вероятно, миграции уже накатываются другим процессом). */
export class MigrationLockBusyError extends Error {
  constructor() {
    super(
      'Не удалось получить advisory-лок миграций — вероятно, накат уже идёт другим процессом. ' +
        'Дождитесь его завершения и повторите.',
    );
    this.name = 'MigrationLockBusyError';
  }
}

/** Отказ писать на standby/read-only (по образцу PayHub-runner). */
async function assertWritablePrimary(sql: postgres.Sql): Promise<void> {
  const rows = await sql<
    Array<{ in_recovery: boolean; tro: string }>
  >`SELECT pg_is_in_recovery() AS in_recovery, current_setting('transaction_read_only') AS tro`;
  if (rows[0]?.in_recovery === true || rows[0]?.tro === 'on') {
    throw new ReadOnlyDatabaseError();
  }
}

/** Прочитать применённые миграции; устойчиво к отсутствию таблицы `_migrations` (для status). */
async function readApplied(sql: postgres.Sql): Promise<AppliedMigration[]> {
  try {
    const rows = await sql<
      AppliedMigration[]
    >`SELECT version, name, checksum FROM public._migrations ORDER BY version`;
    return [...rows];
  } catch (err) {
    // 42P01 — таблицы ещё нет (чистая БД): применённых миграций нет.
    if ((err as { code?: string })?.code === '42P01') return [];
    throw err;
  }
}

export interface MigrationStatus {
  applied: number;
  pending: Array<{ version: number; name: string; action: MigrationAction }>;
  expected: number;
  current: number;
}

/**
 * Статус миграций без изменения БД (для preflight деплоя и отчёта). Не создаёт таблицу,
 * не берёт лок. Возвращает количество применённых, список pending и ожидаемую/текущую версию.
 */
export async function getMigrationStatus(opts: RunMigrationsOptions): Promise<MigrationStatus> {
  const dir = opts.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  assertNotSupabase(opts.databaseUrl);
  const files = loadMigrationFiles(dir);
  const baseline = files.find((f) => f.version === 0);
  const coversThrough = baseline ? parseCoversThrough(baseline.sql) : -1;
  const sql = postgres(opts.databaseUrl, { max: 1, onnotice: () => {}, prepare: false });
  try {
    const applied = await readApplied(sql);
    const plan = planMigrations(files, applied, coversThrough);
    const pending = plan.items
      .filter((i) => i.action !== 'skip')
      .map((i) => ({ version: i.version, name: i.name, action: i.action }));
    return {
      applied: applied.length,
      pending,
      expected: files.length ? Math.max(...files.map((f) => f.version)) : 0,
      current: applied.length ? Math.max(...applied.map((a) => a.version)) : 0,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Применить все непримененные миграции. Каждая execute-миграция — отдельная транзакция
 * (DDL + запись в _migrations атомарны). Cover-миграции (baseline-covered) только фиксируются
 * в _migrations отдельным автокоммит-INSERT, без исполнения их SQL.
 */
export async function runMigrations(opts: RunMigrationsOptions): Promise<RunMigrationsResult> {
  const log = opts.logger ?? ((m: string) => console.log(m));
  const dir = opts.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;

  // Принцип 1: ни при каких условиях не применяем миграции к Supabase (старый прод).
  assertNotSupabase(opts.databaseUrl);

  const files = loadMigrationFiles(dir);
  if (files.length === 0) {
    log(`Миграции не найдены в ${dir}`);
    return { executed: [], covered: [], skipped: [] };
  }
  const baseline = files.find((f) => f.version === 0);
  const coversThrough = baseline ? parseCoversThrough(baseline.sql) : -1;

  const sql = postgres(opts.databaseUrl, { max: 1, onnotice: () => {}, prepare: false });
  const result: RunMigrationsResult = { executed: [], covered: [], skipped: [] };
  let locked = false;

  try {
    // Отказ писать на standby/read-only.
    await assertWritablePrimary(sql);
    // Advisory-лок: защита от параллельного наката (в т.ч. с другой машины).
    const lock = await sql<
      Array<{ locked: boolean }>
    >`SELECT pg_try_advisory_lock(${MIGRATION_ADVISORY_LOCK_KEY}) AS locked`;
    if (!lock[0]?.locked) throw new MigrationLockBusyError();
    locked = true;

    await sql.unsafe(CREATE_MIGRATIONS_TABLE).simple();
    const appliedRows = await sql<
      AppliedMigration[]
    >`SELECT version, name, checksum FROM public._migrations ORDER BY version`;
    const plan = planMigrations(files, [...appliedRows], coversThrough);

    log(
      `Миграций: ${files.length} | execute: ${plan.toExecute}, cover (baseline): ${plan.toCover}, skip: ${plan.toSkip}`,
    );

    for (const item of plan.items) {
      const tag = `${String(item.version).padStart(4, '0')}_${item.name}`;
      if (item.action === 'skip') {
        result.skipped.push(item.version);
        continue;
      }
      if (item.action === 'cover') {
        await sql`
          INSERT INTO public._migrations (version, name, checksum)
          VALUES (${item.version}, ${item.name}, ${item.checksum})
        `;
        result.covered.push(item.version);
        log(`  ⊙ ${tag} — baseline-covered (без исполнения)`);
        continue;
      }
      // execute: DDL + запись в одной транзакции
      await sql.begin(async (tx) => {
        await tx.unsafe(item.sql).simple();
        await tx`
          INSERT INTO public._migrations (version, name, checksum)
          VALUES (${item.version}, ${item.name}, ${item.checksum})
        `;
      });
      result.executed.push(item.version);
      log(`  ✓ ${tag} — применена`);
    }

    log(
      `Готово. Применено: ${result.executed.length}, covered: ${result.covered.length}, уже было: ${result.skipped.length}.`,
    );
    return result;
  } finally {
    if (locked)
      await sql`SELECT pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_KEY})`.catch(() => {});
    await sql.end({ timeout: 5 });
  }
}

/** CLI-точка входа. Режимы: apply (по умолчанию), `status`, `--dry-run`; вывод `--json`. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const isStatus = argv.includes('status') || argv.includes('--status');
  const dryRun = argv.includes('--dry-run');

  const databaseUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Не задан DATABASE_MIGRATION_URL или DATABASE_URL');
    process.exit(1);
  }

  try {
    // status / dry-run — без изменений БД (для preflight деплоя: pending-guard).
    if (isStatus || dryRun) {
      const status = await getMigrationStatus({ databaseUrl });
      if (json) {
        console.log(JSON.stringify(status));
      } else {
        console.log(
          `Миграции: применено ${status.applied}, pending ${status.pending.length} ` +
            `(текущая ${status.current} / ожидается ${status.expected}).`,
        );
        for (const p of status.pending) {
          console.log(`  • ${String(p.version).padStart(4, '0')}_${p.name} — ${p.action}`);
        }
      }
      process.exit(0);
    }

    const result = await runMigrations({ databaseUrl });
    if (json) console.log(JSON.stringify(result));
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (json) console.log(JSON.stringify({ error: msg }));
    else console.error('Миграция провалилась:', msg);
    process.exit(1);
  }
}

// Запуск только при прямом вызове (не при импорте из тестов).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
