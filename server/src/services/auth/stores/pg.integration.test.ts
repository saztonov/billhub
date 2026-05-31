/**
 * Интеграционные тесты Drizzle-хранилищ auth против РЕАЛЬНОГО PostgreSQL (testcontainers).
 *
 * Проверяют то, что in-memory store воспроизвести не может: настоящий SELECT ... FOR UPDATE
 * при ротации refresh-токена (5 параллельных обменов → ровно одна замена) и reuse-detection.
 * А также что миграция 0008 применяется migrate.ts без ошибок и создаёт нужные объекты.
 *
 * Требует Docker. Запуск: RUN_DOCKER_TESTS=1 vitest run (CI / Iteration 8). Без флага — skip.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../db/schema/index.js';
import { users } from '../../../db/schema/index.js';
import { runMigrations } from '../../../cli/migrate.js';
import { DrizzleRefreshTokenStore, DrizzlePasswordResetStore, DrizzleUserAuthStore } from './pg.js';
import { RefreshTokenService } from '../refresh-token.service.js';
import { TokenService } from '../token.service.js';
import { RecordingAuditLogger } from '../audit.js';

const RUN = !!process.env.RUN_DOCKER_TESTS;

describe.skipIf(!RUN)('auth Drizzle-хранилища (testcontainers PG)', () => {
  let container: { getConnectionUri(): string; stop(): Promise<unknown> };
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof schema>;
  let userId: string;

  beforeAll(async () => {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const url = container.getConnectionUri();
    await runMigrations({ databaseUrl: url, logger: () => {} });
    client = postgres(url, { max: 10, onnotice: () => {} });
    db = drizzle(client, { schema });
    userId = randomUUID();
    await db
      .insert(users)
      .values({ id: userId, email: 'race@example.com', fullName: 'Race', role: 'user' });
  }, 120_000);

  afterAll(async () => {
    if (client) await client.end({ timeout: 5 });
    if (container) await container.stop();
  });

  function makeService(audit?: RecordingAuditLogger): RefreshTokenService {
    return new RefreshTokenService({
      store: new DrizzleRefreshTokenStore(db),
      tokens: new TokenService({
        secret: 'integration-secret-long-enough-0123456789',
        issuer: 'BillHub',
        audience: 'billhub',
        accessTtlSeconds: 900,
      }),
      refreshTtlSeconds: 3600,
      graceMs: 5000,
      audit,
    });
  }

  it('миграция 0008 создала refresh_tokens/password_reset_tokens/users.password_hash', async () => {
    const cols = await client<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema='public'
        AND ((table_name='users' AND column_name='password_hash')
          OR (table_name='refresh_tokens' AND column_name='family_id')
          OR (table_name='password_reset_tokens' AND column_name='token_hash'))
    `;
    expect(cols).toHaveLength(3);
  });

  it('5 параллельных rotate из одной family → ровно одна реальная замена (FOR UPDATE)', async () => {
    const svc = makeService();
    const issued = await svc.issueForLogin(userId);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => svc.rotate(issued.refreshToken)),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && r.rotated)).toHaveLength(1);
    const unique = new Set(results.map((r) => (r.ok ? r.refreshToken : 'x')));
    expect(unique.size).toBe(1);

    const rows = await client<{ n: string }[]>`
      SELECT count(*)::text AS n FROM refresh_tokens WHERE family_id = ${issued.familyId}
    `;
    expect(Number(rows[0]!.n)).toBe(2); // исходный + один новый
  });

  it('reuse detection: replay → family revoked + audit', async () => {
    const audit = new RecordingAuditLogger();
    // grace=0 чтобы повтор сразу считался reuse без ожидания
    const svc = new RefreshTokenService({
      store: new DrizzleRefreshTokenStore(db),
      tokens: new TokenService({
        secret: 'integration-secret-long-enough-0123456789',
        issuer: 'BillHub',
        audience: 'billhub',
        accessTtlSeconds: 900,
      }),
      refreshTtlSeconds: 3600,
      graceMs: 0,
      audit,
    });
    const issued = await svc.issueForLogin(userId);
    const r1 = await svc.rotate(issued.refreshToken);
    expect(r1.ok).toBe(true);
    const replay = await svc.rotate(issued.refreshToken);
    expect(replay).toEqual({ ok: false, reason: 'reuse_detected' });

    const active = await client<{ n: string }[]>`
      SELECT count(*)::text AS n FROM refresh_tokens
      WHERE family_id = ${issued.familyId} AND revoked_at IS NULL
    `;
    expect(Number(active[0]!.n)).toBe(0);
    expect(audit.events.some((e) => e.event === 'refresh_reuse')).toBe(true);
  });

  it('DrizzleUserAuthStore.setPasswordHash + DrizzlePasswordResetStore round-trip', async () => {
    const userStore = new DrizzleUserAuthStore(db);
    await userStore.setPasswordHash(userId, '$2b$12$' + 'x'.repeat(53), new Date().toISOString());
    const rec = await userStore.findById(userId);
    expect(rec!.passwordHash).toMatch(/^\$2b\$12\$/);

    const resetStore = new DrizzlePasswordResetStore(db);
    const id = await resetStore.create(
      userId,
      'reset-hash-1',
      new Date(Date.now() + 3600_000).toISOString(),
    );
    const found = await resetStore.findByHash('reset-hash-1');
    expect(found!.id).toBe(id);
    await resetStore.markUsed(id, new Date().toISOString());
    const after = await resetStore.findByHash('reset-hash-1');
    expect(after!.usedAt).not.toBeNull();
  });
});
