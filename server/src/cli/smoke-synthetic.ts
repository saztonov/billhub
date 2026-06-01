/**
 * smoke-synthetic — smoke на синтетике через testcontainers (план Iteration 8).
 *
 * Поднимает чистую инфраструктуру (PostgreSQL + Redis + S3-mock), бутстрапит схему
 * (фильтр schema.sql + миграции 0001/0002/0003), сидит 4 пользователей (по роли) + минимальные
 * справочники, поднимает backend (DB_PROVIDER=drizzle, AUTH_MODE=standalone) и проверяет:
 *
 *   1. production env-проверки ПРИНИМАЮТ корректный prod-конфиг (collectEnvStartupProblems == []);
 *   2. production env-проверки ОТВЕРГАЮТ localhost/non-TLS (защита работает);
 *   3. runtime startup checks PASS против контейнеров (расширения PG + миграция == ожидаемой + S3);
 *   4. GET /api/health/ready == 200 (PG + Redis + S3 + миграции зелёные);
 *   5. логин 4 ролей (admin/user/counterparty_user/security) == 200 через CSRF double-submit;
 *   6. counterparty_user привязан к своему counterparty_id.
 *
 * Полный UI-флоу (создание заявки, согласование, OCR с мок-OpenRouter, СБ) — отдельный
 * e2e/smoke-synthetic.spec.ts (Playwright), запускается оператором на поднятом стеке.
 *
 * Замечание о production startup checks: реальный startup на VPS (env-проверки PASS на боевом
 * verify-full URL) — Operator Gate. Локальный контейнер по определению localhost+non-TLS, поэтому
 * env-проверки здесь валидируются на синтетическом prod-конфиге (п.1–2), а не на контейнерном URL.
 *
 * Запуск: `npm --prefix server run smoke` (нужен Docker). Exit 0 — smoke зелёный.
 */
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { runMigrations } from './migrate.js';
import { filterSchemaViaSed, hasSed, MIGRATIONS_DIR } from './bootstrap-filter.js';

/** Известный пароль всех синтетических пользователей (НЕ для production — только smoke). */
export const SMOKE_PASSWORD = 'Smoke-Pass-12345';

export interface SmokeUser {
  email: string;
  role: 'admin' | 'user' | 'counterparty_user' | 'security';
  fullName: string;
}

/** 4 синтетических пользователя — по одному на роль. Те же creds использует e2e-spec. */
export const SMOKE_USERS: SmokeUser[] = [
  { email: 'admin@smoke.local', role: 'admin', fullName: 'Smoke Admin' },
  { email: 'user@smoke.local', role: 'user', fullName: 'Smoke User' },
  { email: 'contractor@smoke.local', role: 'counterparty_user', fullName: 'Smoke Contractor' },
  { email: 'security@smoke.local', role: 'security', fullName: 'Smoke Security' },
];

function log(msg: string): void {
  console.log(`[smoke] ${msg}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

/** Синтетический production-shaped env (для проверки, что env-чеки ПРИНИМАЮТ валидный конфиг). */
export function productionEnvSample(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    DATABASE_URL:
      'postgresql://billhub_runtime:s3cr3t-not-a-placeholder@rc1a.db.yandexcloud.net:6432/billhub_db?sslmode=verify-full',
    AUTH_JWT_SECRET: 'a'.repeat(48),
    CSRF_SECRET: 'b'.repeat(48),
    AUDIT_HMAC_KEY: 'c'.repeat(48),
    S3_ENDPOINT: 'https://s3.cloud.ru',
    S3_ACCESS_KEY: 'AKIAsmokeRealLookingKey',
    S3_SECRET_KEY: 'realLookingSecretValue1234567890',
    S3_BUCKET: 'billhub-s3',
    SUPABASE_URL: 'https://legacy.example-host.ru',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role',
    SUPABASE_JWT_SECRET: 'legacy-jwt-secret',
  };
}

async function main(): Promise<void> {
  if (!hasSed()) throw new Error('smoke требует GNU sed (для bootstrap-фильтра schema.sql)');
  // Проверка наличия Docker заранее — иначе testcontainers падает с невнятной ошибкой.
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
  } catch {
    throw new Error('smoke требует доступный Docker daemon (testcontainers)');
  }

  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const { GenericContainer, Wait } = await import('testcontainers');

  log('Запуск контейнеров: PostgreSQL + Redis + S3-mock …');
  const pg = await new PostgreSqlContainer('postgres:17-alpine').start();
  const redis = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  const s3mock = await new GenericContainer('adobe/s3mock:latest')
    .withExposedPorts(9090)
    .withEnvironment({ initialBuckets: 'billhub-s3' })
    .withWaitStrategy(Wait.forListeningPorts())
    .start();

  const pgUrl = pg.getConnectionUri();
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  const s3Endpoint = `http://${s3mock.getHost()}:${s3mock.getMappedPort(9090)}`;

  let appClosed = false;
  let app: Awaited<ReturnType<(typeof import('../app.js'))['createApp']>> | undefined;

  try {
    // --- Bootstrap схемы + расширения (как scripts/bootstrap-schema.sh) ---
    log('Bootstrap: расширения + фильтр schema.sql + миграции …');
    const boot = postgres(pgUrl, { max: 1, onnotice: () => {} });
    await boot
      .unsafe(
        'CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext; ' +
          'CREATE EXTENSION IF NOT EXISTS pg_trgm;',
      )
      .simple();
    await boot.unsafe(filterSchemaViaSed()).simple();
    await runMigrations({ databaseUrl: pgUrl, migrationsDir: MIGRATIONS_DIR, logger: () => {} });

    // --- Seed: 1 counterparty / supplier / construction-site / cost-type + 4 пользователя ---
    log('Seed: справочники + 4 пользователя …');
    const passwordHash = bcrypt.hashSync(SMOKE_PASSWORD, 10);
    const [cp] = await boot<{ id: string }[]>`
      INSERT INTO public.counterparties (name, inn) VALUES ('ООО Смоук', '7700000001')
      RETURNING id`;
    const counterpartyId = cp!.id;
    await boot`INSERT INTO public.suppliers (name, inn) VALUES ('Поставщик Смоук', '7700000002')`;
    await boot`INSERT INTO public.construction_sites (name) VALUES ('Объект Смоук')`;
    await boot`INSERT INTO public.cost_types (name) VALUES ('Материалы')`;
    for (const u of SMOKE_USERS) {
      const cpId = u.role === 'counterparty_user' ? counterpartyId : null;
      await boot`
        INSERT INTO public.users (id, email, role, full_name, is_active, password_hash, counterparty_id)
        VALUES (gen_random_uuid(), ${u.email}, ${u.role}, ${u.fullName}, true, ${passwordHash}, ${cpId})`;
    }
    await boot.end({ timeout: 5 });

    // --- Env для backend (ДО динамического импорта config/app) ---
    process.env.NODE_ENV = 'production';
    process.env.DB_PROVIDER = 'drizzle';
    process.env.AUTH_MODE = 'standalone';
    process.env.STORAGE_PROVIDER = 'cloudru';
    process.env.DATABASE_URL = pgUrl;
    process.env.DATABASE_MIGRATION_URL = pgUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.S3_ENDPOINT = s3Endpoint;
    process.env.S3_REGION = 'ru-msk';
    process.env.S3_ACCESS_KEY = 'smoke-access';
    process.env.S3_SECRET_KEY = 'smoke-secret';
    process.env.S3_BUCKET = 'billhub-s3';
    process.env.AUTH_JWT_SECRET = 'smoke-jwt-secret-at-least-32-bytes-long-xx';
    process.env.CSRF_SECRET = 'smoke-csrf-secret-at-least-32-bytes-long-x';
    process.env.AUDIT_HMAC_KEY = 'smoke-audit-hmac-key-at-least-32-bytes-xxx';
    process.env.OPENROUTER_API_KEY = 'smoke-openrouter';
    process.env.RUN_WORKERS = 'false'; // smoke не гоняет задачи — воркеры не нужны
    process.env.SUPABASE_URL = 'http://supabase.smoke.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'smoke';
    process.env.SUPABASE_JWT_SECRET = 'smoke';

    // --- (1)(2) env-проверки: принимают валидный prod-конфиг, отвергают localhost/non-TLS ---
    const checks = await import('../services/observability/startup-checks.js');
    const prodProblems = checks.collectEnvStartupProblems(productionEnvSample());
    assert(
      prodProblems.length === 0,
      `env-проверки должны принимать корректный prod-конфиг, но вернули: ${prodProblems.join('; ')}`,
    );
    log('OK: production env-проверки принимают корректный prod-конфиг');
    const localProblems = checks.collectEnvStartupProblems(process.env);
    assert(
      localProblems.length > 0,
      'env-проверки должны отвергать localhost/non-TLS контейнерный URL',
    );
    log(
      `OK: production env-проверки отвергают localhost/non-TLS (${localProblems.length} проблем)`,
    );

    // --- Поднятие backend ---
    log('Поднятие backend (createApp) …');
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });

    // --- (3) runtime startup checks PASS против контейнеров ---
    const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
    const { sql } = await import('drizzle-orm');
    const expected = 3; // 0001/0002/0003
    const runtimeProblems = await checks.collectRuntimeStartupProblems({
      hasDb: !!app.db,
      queryExtensions: async () => {
        const res = await app!.db!.execute(sql`select extname from pg_extension`);
        return (res as unknown as { extname: string }[]).map((r) => r.extname);
      },
      queryAppliedMigration: async () => {
        const res = await app!.db!.execute(
          sql`select max(version)::int as v from public._migrations`,
        );
        return (res as unknown as { v: number | null }[])[0]?.v ?? null;
      },
      expectedMigration: expected,
      headBucket: async () => {
        await app!.s3Client.send(new HeadBucketCommand({ Bucket: app!.s3Bucket }));
      },
    });
    assert(
      runtimeProblems.length === 0,
      `runtime startup checks должны PASS, но: ${runtimeProblems.join('; ')}`,
    );
    log('OK: runtime startup checks PASS (расширения + миграция == 3 + S3 reachable)');

    // --- (4) /api/health/ready == 200 ---
    const ready = await app.inject({ method: 'GET', url: '/api/health/ready' });
    assert(
      ready.statusCode === 200,
      `/api/health/ready ожидался 200, получен ${ready.statusCode}: ${ready.body}`,
    );
    log('OK: GET /api/health/ready == 200');

    // --- (5) логин 4 ролей через CSRF double-submit ---
    const csrf = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
    const csrfCookie = csrf.cookies.find((c) => c.name === 'csrf_token');
    assert(csrfCookie, 'csrf-плагин должен выдать cookie csrf_token на GET');
    const csrfToken = (csrf.json() as { csrfToken: string }).csrfToken;
    assert(csrfToken === csrfCookie.value, 'csrfToken тела должен совпадать с cookie');

    for (const u of SMOKE_USERS) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-csrf-token': csrfToken, cookie: `csrf_token=${csrfCookie.value}` },
        payload: { email: u.email, password: SMOKE_PASSWORD },
      });
      assert(
        res.statusCode === 200,
        `логин ${u.role} (${u.email}) ожидался 200, получен ${res.statusCode}: ${res.body}`,
      );
      log(`OK: логин ${u.role} == 200`);
    }

    // --- (6) counterparty_user привязан к counterparty_id ---
    const verify = postgres(pgUrl, { max: 1, onnotice: () => {} });
    const [row] = await verify<{ counterparty_id: string | null }[]>`
      SELECT counterparty_id FROM public.users WHERE email = ${'contractor@smoke.local'}`;
    await verify.end({ timeout: 5 });
    assert(
      row?.counterparty_id === counterpartyId,
      'counterparty_user должен быть привязан к своему counterparty_id',
    );
    log('OK: counterparty_user привязан к counterparty_id');

    log('SMOKE ЗЕЛЁНЫЙ ✅');
  } finally {
    if (app && !appClosed) {
      appClosed = true;
      await app.close();
    }
    await s3mock.stop();
    await redis.stop();
    await pg.stop();
  }
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error('[smoke]', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
