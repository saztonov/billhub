/**
 * Тесты GET /api/reports/savings через fastify.inject (без Docker, in-memory auth).
 * Drizzle-клиент подменяется заглушкой: проверяется доступ и сборка ответа из строк агрегата.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import authPlugin from '../plugins/auth.js';
import reportRoutes from './reports.js';
import { _clearUserCache } from '../middleware/authenticate.js';
import { InMemoryUserAuthStore } from '../services/auth/stores/memory.js';
import type { UserAuthRecord } from '../services/auth/stores/types.js';
import type { BillhubDatabase } from '../plugins/database-drizzle.js';

/** Строки агрегата «месяц × сотрудник», которые вернул бы SQL-запрос отчёта. */
const ROWS = [
  { month: '2026-08', user_id: 'u1', full_name: 'Иванов И.И.', cnt: 2, saved: 1500.5 },
  { month: '2026-08', user_id: 'u2', full_name: 'Петров П.П.', cnt: 1, saved: 500 },
  { month: '2026-07', user_id: 'u1', full_name: 'Иванов И.И.', cnt: 3, saved: 1000 },
];

/** Заглушка Drizzle: execute всегда отдаёт заранее заданные строки. */
function fakeDb(rows: unknown[]): BillhubDatabase {
  return { execute: async () => rows } as unknown as BillhubDatabase;
}

async function buildApp(db: BillhubDatabase | undefined): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authPlugin);
  app.decorate('db', db);
  await app.register(reportRoutes);
  await app.ready();
  return app;
}

function rec(over: Partial<UserAuthRecord> = {}): UserAuthRecord {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    role: 'admin',
    counterpartyId: null,
    departmentId: null,
    allSites: true,
    fullName: 'Admin',
    isActive: true,
    passwordHash: null,
    passwordChangedAt: null,
    ...over,
  };
}

async function seedAndSign(
  app: FastifyInstance,
  over: Partial<UserAuthRecord> = {},
): Promise<string> {
  const record = rec(over);
  (app.authServices.users as InMemoryUserAuthStore).upsert(record);
  const { token } = await app.authServices.tokens.signAccess({
    sub: record.id,
    role: record.role,
    email: record.email,
  });
  return token;
}

describe('GET /api/reports/savings', () => {
  let savedMode: string | undefined;

  beforeAll(() => {
    savedMode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = 'standalone';
  });
  afterAll(() => {
    if (savedMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = savedMode;
  });
  beforeEach(() => {
    _clearUserCache();
  });

  it('без авторизации -> 401', async () => {
    const app = await buildApp(fakeDb([]));
    const res = await app.inject({ method: 'GET', url: '/api/reports/savings' });
    expect(res.statusCode).toBe(401);
  });

  it('не-admin -> 403', async () => {
    const app = await buildApp(fakeDb([]));
    const token = await seedAndSign(app, { id: 'user-1', email: 'u@example.com', role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/savings',
      cookies: { access_token: token },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin -> помесячные итоги с разбивкой по сотрудникам и общий итог', async () => {
    const app = await buildApp(fakeDb(ROWS));
    const token = await seedAndSign(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/savings?from=2026-07&to=2026-08',
      cookies: { access_token: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.from).toBe('2026-07');
    expect(body.to).toBe('2026-08');
    expect(body.total).toEqual({ count: 6, saved: 3000.5 });
    expect(body.months).toHaveLength(2);
    expect(body.months[0]).toMatchObject({ month: '2026-08', count: 3, saved: 2000.5 });
    expect(body.months[0].byUser).toHaveLength(2);
    expect(body.months[1]).toMatchObject({ month: '2026-07', count: 3, saved: 1000 });
  });

  it('пустой результат -> нулевой итог без месяцев', async () => {
    const app = await buildApp(fakeDb([]));
    const token = await seedAndSign(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/savings',
      cookies: { access_token: token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: { count: 0, saved: 0 }, months: [] });
  });
});
