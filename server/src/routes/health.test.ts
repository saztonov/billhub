/**
 * Тесты health-роутов: /health/live (всегда 200) и /health/ready (per-dependency, 503 при сбое).
 * Зависимости (db/redis/s3) подменяются fake-декораторами — без реального PG/Redis/S3.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import healthRoutes, { __resetHealthCaches } from './health.js';

interface Fakes {
  appliedMigration?: number;
  dbThrows?: boolean;
  redisPong?: string;
  redisThrows?: boolean;
  s3Throws?: boolean;
}

async function buildApp(fakes: Fakes = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('dbProvider', 'drizzle');
  app.decorate('db', {
    execute: vi.fn().mockImplementation(async () => {
      if (fakes.dbThrows) throw new Error('pg down');
      return [{ v: fakes.appliedMigration ?? 999 }];
    }),
  } as never);
  app.decorate('redis', {
    ping: vi.fn().mockImplementation(async () => {
      if (fakes.redisThrows) throw new Error('redis down');
      return fakes.redisPong ?? 'PONG';
    }),
  } as never);
  app.decorate('s3Client', {
    send: vi.fn().mockImplementation(async () => {
      if (fakes.s3Throws) throw new Error('s3 down');
      return {};
    }),
  } as never);
  app.decorate('s3Bucket', 'test-bucket');
  await app.register(healthRoutes);
  await app.ready();
  return app;
}

describe('GET /api/health/live', () => {
  beforeEach(() => __resetHealthCaches());

  it('всегда 200 без зависимостей', async () => {
    const app = Fastify({ logger: false });
    await app.register(healthRoutes);
    const res = await app.inject({ method: 'GET', url: '/api/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
    await app.close();
  });
});

describe('GET /api/health/ready', () => {
  beforeEach(() => __resetHealthCaches());

  it('200 когда все зависимости здоровы', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.redis.ok).toBe(true);
    expect(body.checks.s3.ok).toBe(true);
    expect(body.checks.migrations.ok).toBe(true);
    await app.close();
  });

  it('503 при недоступном PG', async () => {
    const app = await buildApp({ dbThrows: true });
    const res = await app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.database.ok).toBe(false);
    await app.close();
  });

  it('503 при недоступном Redis', async () => {
    const app = await buildApp({ redisThrows: true });
    const res = await app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.redis.ok).toBe(false);
    await app.close();
  });

  it('503 при недоступном S3', async () => {
    const app = await buildApp({ s3Throws: true });
    const res = await app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.s3.ok).toBe(false);
    await app.close();
  });

  it('503 при отставании миграции (applied < expected)', async () => {
    const app = await buildApp({ appliedMigration: 1 });
    const res = await app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.migrations.ok).toBe(false);
    await app.close();
  });
});
