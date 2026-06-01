/**
 * CI drift-проверка SQL-first схемы (ADR-0002, принцип 6).
 *
 * Запускается через scripts/drizzle-drift.ts (`node scripts/drizzle-drift.ts`),
 * требует Docker (testcontainers). Шаги:
 *   1. Поднять чистый PostgreSQL (testcontainers).
 *   2. Накатить baseline + миграции 001-006 через собственный runner (migrate.ts).
 *   3. Прогнать `drizzle-kit introspect` против накаченной БД — валидация SQL-first workflow.
 *   4. Сверить СТРУКТУРНЫЙ отпечаток коммитнутой TS-схемы (src/db/schema) с реальной БД
 *      (information_schema): таблицы → колонки (базовый тип, nullable, PK, массив).
 *   Любое расхождение → exit 1 (значит, TS-схема разошлась с SQL-миграциями или наоборот).
 *
 * Сравнение структурное (через getTableConfig + information_schema), а не текстовое сравнение
 * вывода introspect — устойчиво к различиям форматирования/раскладки по файлам.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from './schema/index.js';
import { runMigrations } from '../cli/migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '../..');

/** Отпечаток одной колонки. */
interface ColumnFingerprint {
  type: string; // нормализованное семейство типа
  notNull: boolean;
  primaryKey: boolean;
  isArray: boolean;
}
type TableFingerprint = Record<string, ColumnFingerprint>;
type SchemaFingerprint = Record<string, TableFingerprint>;

/** Нормализация типа к семейству (без length/precision) для устойчивого сравнения. */
function normalizeType(raw: string): { type: string; isArray: boolean } {
  let t = raw.trim().toLowerCase();
  const isArray = t.endsWith('[]') || t.startsWith('_');
  t = t.replace(/\[\]$/, '').replace(/^_/, '');
  t = t.replace(/\(.*\)$/, '').trim(); // убрать (255), (15,2)
  const ALIAS: Record<string, string> = {
    'timestamp with time zone': 'timestamptz',
    'timestamp without time zone': 'timestamp',
    'character varying': 'varchar',
    'double precision': 'float8',
    int4: 'integer',
    int8: 'bigint',
    int2: 'smallint',
    bool: 'boolean',
  };
  return { type: ALIAS[t] ?? t, isArray };
}

/** Отпечаток коммитнутой Drizzle-схемы через getTableConfig. */
export function fingerprintCommitted(mod: Record<string, unknown>): SchemaFingerprint {
  const out: SchemaFingerprint = {};
  for (const val of Object.values(mod)) {
    if (!is(val, PgTable)) continue;
    const cfg = getTableConfig(val as PgTable);
    const cols: TableFingerprint = {};
    for (const c of cfg.columns) {
      const { type, isArray } = normalizeType(c.getSQLType());
      cols[c.name] = { type, notNull: c.notNull, primaryKey: c.primary, isArray };
    }
    out[cfg.name] = cols;
  }
  return out;
}

/** Отпечаток реальной БД через information_schema. */
export async function fingerprintDatabase(sql: postgres.Sql): Promise<SchemaFingerprint> {
  // Дочерние партиции (relispartition=true) не входят в TS-схему — фингерпринтим только
  // родительскую партиционированную таблицу (audit_log), а audit_log_YYYY_MM / _default опускаем.
  const partitions = await sql<{ relname: string }[]>`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relispartition = true
  `;
  const partitionChildren = new Set(partitions.map((p) => p.relname));

  const cols = await sql<
    {
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
    }[]
  >`
    SELECT table_name, column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name <> '_migrations'
    ORDER BY table_name, ordinal_position
  `;
  const pks = await sql<{ table_name: string; column_name: string }[]>`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
  `;
  const pkSet = new Set(pks.map((p) => `${p.table_name}.${p.column_name}`));

  const out: SchemaFingerprint = {};
  for (const c of cols) {
    if (partitionChildren.has(c.table_name)) continue;
    const raw =
      c.data_type === 'ARRAY' || c.data_type === 'USER-DEFINED' ? c.udt_name : c.data_type;
    const { type, isArray } = normalizeType(raw);
    (out[c.table_name] ??= {})[c.column_name] = {
      type,
      notNull: c.is_nullable === 'NO',
      primaryKey: pkSet.has(`${c.table_name}.${c.column_name}`),
      isArray: isArray || c.data_type === 'ARRAY',
    };
  }
  return out;
}

/** Сравнение двух отпечатков. Возвращает список расхождений (пустой = OK). */
export function diffFingerprints(committed: SchemaFingerprint, db: SchemaFingerprint): string[] {
  const diffs: string[] = [];
  const tables = new Set([...Object.keys(committed), ...Object.keys(db)]);
  for (const t of [...tables].sort()) {
    const c = committed[t];
    const d = db[t];
    if (!c) {
      diffs.push(`Таблица '${t}' есть в БД, но НЕ в TS-схеме`);
      continue;
    }
    if (!d) {
      diffs.push(`Таблица '${t}' есть в TS-схеме, но НЕ в БД`);
      continue;
    }
    const cols = new Set([...Object.keys(c), ...Object.keys(d)]);
    for (const col of [...cols].sort()) {
      const cc = c[col];
      const dc = d[col];
      if (!cc) {
        diffs.push(`${t}.${col}: есть в БД, нет в TS-схеме`);
        continue;
      }
      if (!dc) {
        diffs.push(`${t}.${col}: есть в TS-схеме, нет в БД`);
        continue;
      }
      if (cc.type !== dc.type) diffs.push(`${t}.${col}: тип TS='${cc.type}' vs БД='${dc.type}'`);
      if (cc.notNull !== dc.notNull)
        diffs.push(`${t}.${col}: notNull TS=${cc.notNull} vs БД=${dc.notNull}`);
      if (cc.primaryKey !== dc.primaryKey)
        diffs.push(`${t}.${col}: primaryKey TS=${cc.primaryKey} vs БД=${dc.primaryKey}`);
      if (cc.isArray !== dc.isArray)
        diffs.push(`${t}.${col}: isArray TS=${cc.isArray} vs БД=${dc.isArray}`);
    }
  }
  return diffs;
}

/** Полный прогон drift-проверки. Возвращает код выхода (0 = OK). */
export async function runDriftCheck(): Promise<number> {
  const log = (m: string) => console.log(`[drift] ${m}`);
  log('Старт PostgreSQL (testcontainers)…');
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const url = container.getConnectionUri();

  try {
    log('Накат baseline + миграций через migrate.ts…');
    await runMigrations({ databaseUrl: url, logger: (m) => console.log(`[migrate] ${m}`) });

    log('drizzle-kit introspect (валидация SQL-first workflow)…');
    const introspect = spawnSync('npx', ['drizzle-kit', 'introspect'], {
      cwd: SERVER_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (introspect.status !== 0) {
      log('drizzle-kit introspect завершился с ошибкой');
      return 1;
    }

    log('Сверка структурного отпечатка TS-схемы с БД…');
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const dbFp = await fingerprintDatabase(sql);
      const tsFp = fingerprintCommitted(schema as Record<string, unknown>);
      const diffs = diffFingerprints(tsFp, dbFp);
      if (diffs.length > 0) {
        log(`НАЙДЕНО РАСХОЖДЕНИЙ: ${diffs.length}`);
        for (const d of diffs) console.log(`  ✗ ${d}`);
        return 1;
      }
      log(`OK: ${Object.keys(tsFp).length} таблиц совпадают (TS-схема ↔ SQL-миграции).`);
      return 0;
    } finally {
      await sql.end({ timeout: 5 });
    }
  } finally {
    await container.stop();
  }
}

// CLI-точка (через `tsx src/db/drift.ts`, запускается из scripts/drizzle-drift.ts).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDriftCheck()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('[drift] Ошибка:', err);
      process.exit(1);
    });
}
