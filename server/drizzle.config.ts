import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit конфиг — ТОЛЬКО для `drizzle-kit introspect:pg` (ADR-0002, принцип 6).
 *
 * `drizzle-kit generate` и `drizzle-kit push` НЕ используются: SQL-миграции —
 * единственный источник правды; TS-схема в src/db/schema производна через introspect.
 *
 * Применение: поднять PG (testcontainers/локальный), накатить baseline + миграции
 * через `npm run db:migrate`, затем `npm run drizzle:introspect` для сверки с TS-схемой.
 * Автоматическая drift-проверка — scripts/drizzle-drift.ts.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle/introspect',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? process.env.DATABASE_MIGRATION_URL ?? '',
  },
  introspect: { casing: 'camel' },
  verbose: true,
  strict: true,
});
