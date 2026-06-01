/**
 * Интеграционный тест bootstrap-схемы на чистом PostgreSQL (testcontainers) — Gate Iteration 8.
 *
 * Воспроизводит scripts/bootstrap-schema.sh БЕЗ psql (кросс-платформенно):
 *   1. CREATE EXTENSION pgcrypto/citext/pg_trgm (шаг администратора кластера).
 *   2. Применение отфильтрованного sql/schema/schema.sql (тот же sed-фильтр, что в production)
 *      через postgres.js .simple() — аналог `psql -f` с ON_ERROR_STOP (батч падает на первой ошибке).
 *   3. Инкрементальные миграции 0001/0002/0003 через собственный runner (как `node migrate.js`).
 * Затем проверяет, что итоговый набор таблиц соответствует ожидаемому.
 *
 * Запуск: `RUN_INTEGRATION=1 npm test` (или CI). Без Docker/sed — пропускается.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { runMigrations } from './migrate.js';
import { filterSchemaViaSed, hasSed, MIGRATIONS_DIR } from './bootstrap-filter.js';

const RUN = (process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true') && hasSed();

describe.skipIf(!RUN)('bootstrap-schema на testcontainers PostgreSQL (Iteration 8 Gate)', () => {
  let container!: StartedPostgreSqlContainer;
  let sql!: postgres.Sql;
  let url!: string;

  beforeAll(async () => {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    url = container.getConnectionUri();
    sql = postgres(url, { max: 1, onnotice: () => {} });

    // Шаг администратора: расширения ДО bootstrap (стандарт v3 §8; фильтр убирает CREATE EXTENSION).
    await sql
      .unsafe(
        'CREATE EXTENSION IF NOT EXISTS pgcrypto; ' +
          'CREATE EXTENSION IF NOT EXISTS citext; ' +
          'CREATE EXTENSION IF NOT EXISTS pg_trgm;',
      )
      .simple();

    // Шаг 1 bootstrap: отфильтрованная схема (тот же sed-фильтр, что в bootstrap-schema.sh).
    const filtered = filterSchemaViaSed();
    await sql.unsafe(filtered).simple();

    // Шаг 2 bootstrap: инкрементальные миграции 0001+ через runner.
    await runMigrations({ databaseUrl: url, migrationsDir: MIGRATIONS_DIR, logger: () => {} });
  }, 240_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (container) await container.stop();
  });

  /** Множество таблиц public-схемы. */
  async function tableSet(): Promise<Set<string>> {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    return new Set(rows.map((r) => r.table_name));
  }

  it('последняя применённая миграция == 3 (0001/0002/0003)', async () => {
    const rows = await sql<{ v: number }[]>`SELECT max(version)::int AS v FROM public._migrations`;
    expect(rows[0]?.v).toBe(3);
  });

  it('таблицы из schema.sql присутствуют (прикладная схема)', async () => {
    const tables = await tableSet();
    for (const t of [
      'users',
      'counterparties',
      'suppliers',
      'payment_requests',
      'contract_requests',
      'specifications',
      'approval_decisions',
      'construction_sites',
      'error_logs',
    ]) {
      expect(tables.has(t), `ожидалась таблица ${t}`).toBe(true);
    }
  });

  it('таблицы auth standalone (0001): password_hash + refresh_tokens + password_reset_tokens', async () => {
    const tables = await tableSet();
    expect(tables.has('refresh_tokens')).toBe(true);
    expect(tables.has('password_reset_tokens')).toBe(true);
    const colRows = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='users' AND column_name='password_hash'
      ) AS exists`;
    expect(colRows[0]?.exists).toBe(true);
  });

  it('таблицы observability (0002): outbox + jobs_log + audit_log (партиционированная)', async () => {
    const tables = await tableSet();
    expect(tables.has('outbox')).toBe(true);
    expect(tables.has('jobs_log')).toBe(true);
    // audit_log — партиционированная: в pg_partitioned_table должна быть запись.
    const partRows = await sql<{ ispart: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_partitioned_table pt
        JOIN pg_class c ON c.oid = pt.partrelid
        WHERE c.relname = 'audit_log'
      ) AS ispart`;
    expect(partRows[0]?.ispart).toBe(true);
  });

  it('FK users_id_fkey → auth.users отсутствует (sed-фильтр убрал), а change_user_password удалена (0003)', async () => {
    const fkRows = await sql<{ fk: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_id_fkey'
      ) AS fk`;
    expect(fkRows[0]?.fk).toBe(false);
    const fnRows = await sql<{ fn: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'change_user_password'
      ) AS fn`;
    expect(fnRows[0]?.fn).toBe(false);
  });

  it('SQL-функции нумерации/листинга из schema.sql доступны', async () => {
    const cntRows = await sql<{ cnt: number }[]>`
      SELECT count(*)::int AS cnt FROM pg_proc
      WHERE proname IN ('generate_request_number','generate_contract_request_number',
                        'list_counterparties_with_sb','list_suppliers_with_sb')`;
    expect(cntRows[0]?.cnt).toBeGreaterThanOrEqual(4);
  });
});
