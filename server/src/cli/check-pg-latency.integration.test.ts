/**
 * Integration-тест ФОРМЫ скрипта check-pg-latency на testcontainers (Iteration 8 Gate:
 * «check-pg-latency.ts валидируется на testcontainers — форма скрипта корректна»).
 *
 * Бутстрапит чистую БД (фильтр schema.sql + миграции), запускает runProbe и проверяет, что
 * план из 100 запросов реально выполняется против counterparties / list_counterparties_with_sb,
 * сводки конечны. Пороговые значения НЕ проверяем (локальный контейнер ≠ реальная сеть до Yandex).
 *
 * Запуск: `RUN_INTEGRATION=1 npm test`. Без Docker/sed — пропускается.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { runMigrations } from './migrate.js';
import { filterSchemaViaSed, hasSed, MIGRATIONS_DIR } from './bootstrap-filter.js';
import { runProbe, summarize, evaluate } from './check-pg-latency.js';

const RUN = (process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true') && hasSed();

describe.skipIf(!RUN)('check-pg-latency: форма на testcontainers', () => {
  let container!: StartedPostgreSqlContainer;
  let sql!: postgres.Sql;

  beforeAll(async () => {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const url = container.getConnectionUri();
    sql = postgres(url, { max: 1, onnotice: () => {} });
    await sql
      .unsafe(
        'CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext; ' +
          'CREATE EXTENSION IF NOT EXISTS pg_trgm;',
      )
      .simple();
    await sql.unsafe(filterSchemaViaSed()).simple();
    await runMigrations({ databaseUrl: url, migrationsDir: MIGRATIONS_DIR, logger: () => {} });
  }, 240_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (container) await container.stop();
  });

  it('runProbe выполняет 100 запросов и возвращает конечные сводки', async () => {
    const result = await runProbe(sql);
    expect(result.samples).toHaveLength(100);
    expect(Number.isFinite(result.overall.medianMs)).toBe(true);
    expect(Number.isFinite(result.overall.p95Ms)).toBe(true);
    expect(result.byKind.select1.count).toBe(30);
    expect(result.byKind.pk_lookup.count).toBe(30);
    expect(result.byKind.lateral_join.count).toBe(40);
  });

  it('evaluate/summarize работают на реальной выборке (локально пороги обычно проходят)', async () => {
    const result = await runProbe(sql);
    const s = summarize(result.samples.map((x) => x.ms));
    expect(s.count).toBe(100);
    // На локальном unix-socket/loopback контейнере latency микроскопическая — verdict.ok.
    expect(evaluate(s).ok).toBe(true);
  });
});
