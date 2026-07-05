/**
 * Unit-тесты production startup checks (план Iteration 7, §7, GATE).
 * Каждый failure-кейс — отдельная проверка.
 */
import { describe, it, expect } from 'vitest';
import {
  checkRequiredEnv,
  checkNoPlaceholders,
  checkSslMode,
  checkNoDevFlags,
  checkExtensions,
  checkAppliedMigration,
  checkAuthModeInvariant,
  collectRuntimeStartupProblems,
  assertEnvStartup,
  StartupCheckError,
  type StartupEnv,
} from './startup-checks.js';

describe('checkAuthModeInvariant (Ф4)', () => {
  it('standalone и keycloak разрешены в production', () => {
    expect(checkAuthModeInvariant({ NODE_ENV: 'production', AUTH_MODE: 'standalone' })).toEqual([]);
    expect(checkAuthModeInvariant({ NODE_ENV: 'production', AUTH_MODE: 'keycloak' })).toEqual([]);
  });
  it('supabase-bridge в production — проблема', () => {
    expect(
      checkAuthModeInvariant({ NODE_ENV: 'production', AUTH_MODE: 'supabase-bridge' }),
    ).toHaveLength(1);
  });
  it('вне production — no-op', () => {
    expect(
      checkAuthModeInvariant({ NODE_ENV: 'development', AUTH_MODE: 'supabase-bridge' }),
    ).toEqual([]);
  });
});

/** Валидное production-окружение (без проблем). */
function goodEnv(): StartupEnv {
  return {
    NODE_ENV: 'production',
    AUTH_MODE: 'standalone',
    DATABASE_URL:
      'postgres://billhub_runtime:pw@rc1a.db.yandexcloud.net:6432/billhub_db?sslmode=verify-full',
    AUTH_JWT_SECRET: 'a-real-long-secret-value-1234567890',
    CSRF_SECRET: 'another-real-secret-0987654321',
    AUDIT_HMAC_KEY: 'real-hmac-key-abcdef',
    S3_ENDPOINT: 'https://s3.cloud.ru',
    S3_ACCESS_KEY: 'AKIAreal',
    S3_SECRET_KEY: 'realsecret',
    S3_BUCKET: 'billhub-prod',
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    SUPABASE_JWT_SECRET: 'jwt',
  };
}

describe('startup-checks: чистые проверки', () => {
  it('checkRequiredEnv ловит отсутствие обязательных', () => {
    const env = goodEnv();
    delete env.DATABASE_URL;
    delete env.AUTH_JWT_SECRET;
    const problems = checkRequiredEnv(env);
    expect(problems).toHaveLength(2);
    expect(problems.join()).toMatch(/DATABASE_URL/);
  });

  it('checkNoPlaceholders ловит CHANGE_ME / dev-insecure / example.com / localhost', () => {
    expect(checkNoPlaceholders({ AUTH_JWT_SECRET: 'dev-insecure-x' })).toHaveLength(1);
    expect(checkNoPlaceholders({ CSRF_SECRET: 'CHANGE_ME' })).toHaveLength(1);
    expect(checkNoPlaceholders({ DATABASE_URL: 'postgres://u@localhost/db' })).toHaveLength(1);
    expect(checkNoPlaceholders({ S3_ENDPOINT: 'https://example.com' })).toHaveLength(1);
    expect(checkNoPlaceholders({ AUDIT_HMAC_KEY: 'real-key' })).toHaveLength(0);
  });

  it('checkSslMode требует sslmode=verify-full', () => {
    expect(checkSslMode('postgres://h/db?sslmode=require')).toHaveLength(1);
    expect(checkSslMode('postgres://h/db?sslmode=verify-full')).toHaveLength(0);
  });

  it('checkNoDevFlags ловит DEBUG в production', () => {
    expect(checkNoDevFlags({ NODE_ENV: 'production', DEBUG: '*' })).toHaveLength(1);
    expect(checkNoDevFlags({ NODE_ENV: 'production' })).toHaveLength(0);
    expect(checkNoDevFlags({ NODE_ENV: 'development', DEBUG: '*' })).toHaveLength(0);
  });

  it('checkExtensions ловит отсутствие pgcrypto/citext/pg_trgm', () => {
    expect(checkExtensions(['pgcrypto', 'citext', 'pg_trgm'])).toHaveLength(0);
    expect(checkExtensions(['pgcrypto'])).toHaveLength(2);
  });

  it('checkAppliedMigration ловит пустую _migrations и отставание', () => {
    expect(checkAppliedMigration(null, 3)).toHaveLength(1);
    expect(checkAppliedMigration(1, 3)).toHaveLength(1);
    expect(checkAppliedMigration(3, 3)).toHaveLength(0);
    expect(checkAppliedMigration(4, 3)).toHaveLength(0);
  });
});

describe('startup-checks: assertEnvStartup', () => {
  it('не падает на валидном production-окружении', () => {
    expect(() => assertEnvStartup(goodEnv())).not.toThrow();
  });

  it('падает в production при отсутствии обязательных env', () => {
    const env = goodEnv();
    delete env.DATABASE_URL;
    expect(() => assertEnvStartup(env)).toThrow(StartupCheckError);
  });

  it('падает при placeholder', () => {
    const env = goodEnv();
    env.AUTH_JWT_SECRET = 'dev-insecure-auth-jwt-secret-change-me';
    expect(() => assertEnvStartup(env)).toThrow(StartupCheckError);
  });

  it('падает при sslmode != verify-full', () => {
    const env = goodEnv();
    env.DATABASE_URL =
      'postgres://billhub_runtime:pw@rc1a.db.yandexcloud.net:6432/billhub_db?sslmode=require';
    expect(() => assertEnvStartup(env)).toThrow(StartupCheckError);
  });

  it('не запускается вне production (dev на placeholder допустим)', () => {
    expect(() => assertEnvStartup({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('падает в production при AUTH_MODE != standalone (C1)', () => {
    const env = goodEnv();
    env.AUTH_MODE = 'supabase-bridge';
    expect(() => assertEnvStartup(env)).toThrow(StartupCheckError);
  });

  it('в standalone не требует SUPABASE_* (Этап 1, VPS2)', () => {
    const env = goodEnv();
    delete env.SUPABASE_URL;
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    delete env.SUPABASE_JWT_SECRET;
    expect(() => assertEnvStartup(env)).not.toThrow();
  });
});

describe('startup-checks: collectRuntimeStartupProblems', () => {
  const okDeps = {
    hasDb: true,
    queryExtensions: async () => ['pgcrypto', 'citext', 'pg_trgm'],
    queryAppliedMigration: async () => 3,
    expectedMigration: 3,
    headBucket: async () => {},
  };

  it('пусто при всех ОК', async () => {
    expect(await collectRuntimeStartupProblems(okDeps)).toHaveLength(0);
  });

  it('ловит отсутствие расширений', async () => {
    const problems = await collectRuntimeStartupProblems({
      ...okDeps,
      queryExtensions: async () => ['pgcrypto'],
    });
    expect(problems.join()).toMatch(/citext|pg_trgm/);
  });

  it('ловит недоступность S3', async () => {
    const problems = await collectRuntimeStartupProblems({
      ...okDeps,
      headBucket: async () => {
        throw new Error('bucket missing');
      },
    });
    expect(problems.join()).toMatch(/S3 HEAD bucket/);
  });

  it('ловит DB_PROVIDER!=drizzle', async () => {
    const problems = await collectRuntimeStartupProblems({ ...okDeps, hasDb: false });
    expect(problems.join()).toMatch(/fastify.db не инициализирован/);
  });
});
