/**
 * import-passwords — перенос bcrypt-хэшей паролей из Supabase auth.users.encrypted_password
 * в public.users.password_hash (план Iteration 6; запускается в Iteration 9 на копии данных
 * и в окне cutover Iteration 10 на дельте). В Iteration 6 — только на ТЕСТОВОМ наборе.
 *
 * Опции:
 *   --source-url <postgres://...>     — прямое подключение к БД-источнику (Supabase), читает
 *                                       auth.users.encrypted_password. encrypted_password НЕ
 *                                       доступен через PostgREST/Supabase REST — нужен прямой PG.
 *   --source-key <service-key>        — service-role key (для сверки списка через Supabase Admin;
 *                                       сам хэш берётся только из --source-url).
 *   --target-database-url <postgres://...> — целевая БД (Yandex Managed PG), public.users.
 *   --verify-sample <N>               — на N случайных перенесённых пользователях проверить,
 *                                       что hash в формате $2a/$2b/$2y.
 *
 * Чистая логика (runImport) отделена от драйверов БД и покрыта unit-тестом на 100 синтетических
 * пользователях без Docker; PG-драйверы — для реального прогона.
 */
import postgres from 'postgres';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PasswordService } from '../services/auth/password.service.js';

/* ------------------------------- Порты ------------------------------------- */

export interface SourceUser {
  id: string;
  email: string;
  encryptedPassword: string | null;
}

export interface SourceReader {
  readUsers(): Promise<SourceUser[]>;
}

export interface TargetWriter {
  /** Обновляет password_hash. Возвращает true, если строка пользователя найдена в target. */
  setPasswordHash(userId: string, hash: string): Promise<boolean>;
  getPasswordHash(userId: string): Promise<string | null>;
}

export interface ImportResult {
  total: number;
  migrated: number;
  /** Пропущены: null/не-bcrypt encrypted_password или отсутствует в target. */
  skipped: number;
  verified: number;
  verifyFailures: string[];
}

export interface RunImportOptions {
  source: SourceReader;
  target: TargetWriter;
  verifySample?: number;
  logger?: (msg: string) => void;
  /** Источник случайности выборки (инъекция для детерминированных тестов). */
  random?: () => number;
}

/* ---------------------------- Чистая логика -------------------------------- */

/** Случайная выборка до n индексов из [0, length). */
function sampleIndexes(length: number, n: number, random: () => number): number[] {
  const idx = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx.slice(0, Math.min(n, length));
}

export async function runImport(opts: RunImportOptions): Promise<ImportResult> {
  const log = opts.logger ?? ((m: string) => console.log(m));
  const random = opts.random ?? Math.random;

  const users = await opts.source.readUsers();
  const result: ImportResult = {
    total: users.length,
    migrated: 0,
    skipped: 0,
    verified: 0,
    verifyFailures: [],
  };

  const migratedIds: string[] = [];
  for (const u of users) {
    if (!u.encryptedPassword || !PasswordService.isBcryptHash(u.encryptedPassword)) {
      result.skipped += 1;
      continue;
    }
    const updated = await opts.target.setPasswordHash(u.id, u.encryptedPassword);
    if (!updated) {
      result.skipped += 1;
      continue;
    }
    result.migrated += 1;
    migratedIds.push(u.id);
  }

  log(`Источник: ${result.total}, перенесено: ${result.migrated}, пропущено: ${result.skipped}`);

  const sampleN = opts.verifySample ?? 0;
  if (sampleN > 0 && migratedIds.length > 0) {
    const picks = sampleIndexes(migratedIds.length, sampleN, random);
    for (const i of picks) {
      const id = migratedIds[i]!;
      const hash = await opts.target.getPasswordHash(id);
      if (hash && PasswordService.isBcryptHash(hash)) {
        result.verified += 1;
      } else {
        result.verifyFailures.push(id);
      }
    }
    log(
      `Проверено выборкой: ${result.verified}/${picks.length}` +
        (result.verifyFailures.length ? `, провалов: ${result.verifyFailures.length}` : ''),
    );
  }

  return result;
}

/* --------------------------- PG-драйверы ----------------------------------- */

export class PgSourceReader implements SourceReader {
  constructor(private readonly url: string) {}

  async readUsers(): Promise<SourceUser[]> {
    const sql = postgres(this.url, { max: 1, onnotice: () => {}, prepare: false });
    try {
      const rows = await sql<
        { id: string; email: string | null; encrypted_password: string | null }[]
      >`
        SELECT id, email::text AS email, encrypted_password
        FROM auth.users
      `;
      return rows.map((r) => ({
        id: r.id,
        email: r.email ?? '',
        encryptedPassword: r.encrypted_password,
      }));
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}

export class PgTargetWriter implements TargetWriter {
  private readonly sql: postgres.Sql;
  constructor(url: string) {
    this.sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });
  }

  async setPasswordHash(userId: string, hash: string): Promise<boolean> {
    const res = await this.sql`
      UPDATE public.users
      SET password_hash = ${hash}, password_changed_at = now()
      WHERE id = ${userId}
    `;
    return res.count > 0;
  }

  async getPasswordHash(userId: string): Promise<string | null> {
    const [row] = await this.sql<{ password_hash: string | null }[]>`
      SELECT password_hash FROM public.users WHERE id = ${userId}
    `;
    return row ? row.password_hash : null;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

/* ------------------------------- CLI --------------------------------------- */

interface CliArgs {
  sourceUrl?: string;
  sourceKey?: string;
  targetUrl?: string;
  verifySample: number;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { verifySample: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--source-url') {
      out.sourceUrl = next;
      i += 1;
    } else if (a === '--source-key') {
      out.sourceKey = next;
      i += 1;
    } else if (a === '--target-database-url') {
      out.targetUrl = next;
      i += 1;
    } else if (a === '--verify-sample') {
      out.verifySample = Number.parseInt(next ?? '0', 10);
      i += 1;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sourceUrl || !args.targetUrl) {
    console.error(
      'Использование: import-passwords --source-url <pg> --target-database-url <pg> [--verify-sample N]',
    );
    process.exit(1);
  }
  if (!/^postgres(ql)?:\/\//.test(args.sourceUrl)) {
    console.error(
      '--source-url должен быть postgres://-строкой к БД источника: encrypted_password недоступен через Supabase REST.',
    );
    process.exit(1);
  }

  const source = new PgSourceReader(args.sourceUrl);
  const target = new PgTargetWriter(args.targetUrl);
  try {
    const res = await runImport({ source, target, verifySample: args.verifySample });
    if (res.verifyFailures.length > 0) {
      console.error(`Проверка не пройдена для ${res.verifyFailures.length} пользователей.`);
      process.exit(1);
    }
    console.log('import-passwords завершён успешно.');
    process.exit(0);
  } catch (err) {
    console.error('import-passwords провалился:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await target.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
