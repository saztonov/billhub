import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { DEFAULT_MIGRATIONS_DIR, loadMigrationFiles } from '../cli/migrate.js';
import { assertKeycloakReady } from '../services/auth/keycloak/readiness.js';

/** Гонка промиса с таймаутом (reject при превышении). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Ожидаемая (последняя) версия миграции по файлам sql/migrations (кэш, best-effort). */
let expectedMigrationCache: number | null | undefined;
function expectedMigrationVersion(): number | null {
  if (expectedMigrationCache !== undefined) return expectedMigrationCache;
  try {
    const files = loadMigrationFiles(DEFAULT_MIGRATIONS_DIR);
    expectedMigrationCache = files.length ? Math.max(...files.map((f) => f.version)) : null;
  } catch {
    expectedMigrationCache = null;
  }
  return expectedMigrationCache;
}

/** Кэш результата S3 HEAD bucket (TTL 30с) — S3-проба дорогая для частого /ready. */
let s3Cache: { ok: boolean; ts: number } | null = null;
const S3_CACHE_MS = 30_000;

/** Маршруты проверки состояния сервера */
export default async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  /** Liveness — без зависимостей, всегда 200 (для external uptime monitoring и orchestrator). */
  fastify.get('/api/health/live', async () => {
    return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() };
  });

  /** Базовая проверка (обратная совместимость) — сервер работает. */
  fastify.get('/api/health', async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * Readiness — PG SELECT 1 (timeout 1с), S3 HEAD bucket (cached 30с), Redis ping (timeout 500мс),
   * last migration applied. Возвращает 503 при сбое любой критичной зависимости + per-dependency JSON.
   */
  fastify.get('/api/health/ready', async (_request, reply) => {
    const checks: Record<string, { ok: boolean; detail?: unknown }> = {};

    // --- PostgreSQL ---
    if (fastify.dbProvider === 'drizzle' && fastify.db) {
      try {
        await withTimeout(fastify.db.execute(sql`select 1`), 1000);
        checks.database = { ok: true };
      } catch (err) {
        checks.database = { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    } else if (fastify.hasDecorator('supabase') && fastify.supabase) {
      try {
        const { error } = await fastify.supabase.from('users').select('id').limit(1);
        checks.database = { ok: !error };
      } catch (err) {
        checks.database = { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    } else {
      checks.database = { ok: false, detail: 'нет активного провайдера БД' };
    }

    // --- last migration applied ---
    if (fastify.dbProvider === 'drizzle' && fastify.db) {
      try {
        const res = await withTimeout(
          fastify.db.execute(sql`select max(version)::int as v from public._migrations`),
          1000,
        );
        const rows = res as unknown as Array<{ v: number | null }>;
        const applied = rows[0]?.v ?? null;
        const expected = expectedMigrationVersion();
        const ok = applied !== null && (expected === null || applied >= expected);
        checks.migrations = { ok, detail: { applied, expected } };
      } catch (err) {
        checks.migrations = { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    } else {
      checks.migrations = { ok: true, detail: 'skipped (не drizzle)' };
    }

    // --- Redis ---
    if (fastify.hasDecorator('redis') && fastify.redis) {
      try {
        const pong = await withTimeout(fastify.redis.ping(), 500);
        checks.redis = { ok: pong === 'PONG' };
      } catch (err) {
        checks.redis = { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    } else {
      checks.redis = { ok: false, detail: 'redis не инициализирован' };
    }

    // --- S3 (HEAD bucket, cached 30s) ---
    if (fastify.hasDecorator('s3Client') && fastify.s3Client) {
      const now = Date.now();
      if (s3Cache && now - s3Cache.ts < S3_CACHE_MS) {
        checks.s3 = { ok: s3Cache.ok, detail: 'cached' };
      } else {
        let ok = false;
        let detail: unknown;
        try {
          await withTimeout(
            fastify.s3Client.send(new HeadBucketCommand({ Bucket: fastify.s3Bucket })),
            2000,
          );
          ok = true;
        } catch (err) {
          detail = err instanceof Error ? err.message : String(err);
        }
        s3Cache = { ok, ts: now };
        checks.s3 = { ok, detail };
      }
    } else {
      checks.s3 = { ok: false, detail: 's3 не инициализирован' };
    }

    // --- Keycloak (discovery/JWKS, только keycloak-режим) ---
    if (fastify.authMode === 'keycloak') {
      try {
        await assertKeycloakReady(2000);
        checks.keycloak = { ok: true };
      } catch (err) {
        checks.keycloak = { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    reply.code(allOk ? 200 : 503);
    return { status: allOk ? 'ok' : 'unavailable', checks };
  });
}

/** Сброс кэша S3-пробы (только для тестов). */
export function __resetHealthCaches(): void {
  s3Cache = null;
  expectedMigrationCache = undefined;
}
