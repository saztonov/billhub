/**
 * Тесты роутов настройки «Автосоздание РП» (GET/PUT /api/payhub/rp-auto-create) через
 * fastify.inject: только admin, по умолчанию включено, валидация тела.
 * БД — минимальный фейк цепочек drizzle (select/insert), без Docker; in-memory auth.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import authPlugin from '../plugins/auth.js';
import payhubRoutes from './payhub.js';
import { _clearUserCache } from '../middleware/authenticate.js';
import { InMemoryUserAuthStore } from '../services/auth/stores/memory.js';
import type { UserAuthRecord } from '../services/auth/stores/types.js';

/** Хранилище настройки: value строки settings или null (строки нет) */
interface FakeState {
  value: unknown;
}

/** Фейк drizzle-цепочек, используемых getRpAutoCreateEnabled/setRpAutoCreateEnabled */
function fakeDb(state: FakeState) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (state.value == null ? [] : [{ value: state.value }]),
        }),
      }),
    }),
    insert: () => ({
      values: (row: { value: unknown }) => ({
        onConflictDoUpdate: async () => {
          state.value = row.value;
        },
      }),
    }),
  };
}

async function buildApp(state: FakeState): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authPlugin);
  app.decorate('payhub', null);
  app.decorate('db', fakeDb(state) as unknown as FastifyInstance['db']);
  await app.register(payhubRoutes);
  await app.ready();
  return app;
}

async function seedAndSign(
  app: FastifyInstance,
  over: Partial<UserAuthRecord> = {},
): Promise<string> {
  const record: UserAuthRecord = {
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
  (app.authServices.users as InMemoryUserAuthStore).upsert(record);
  const { token } = await app.authServices.tokens.signAccess({
    sub: record.id,
    role: record.role,
    email: record.email,
  });
  return token;
}

describe('/api/payhub/rp-auto-create', () => {
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

  it('GET без авторизации -> 401', async () => {
    const app = await buildApp({ value: null });
    const res = await app.inject({ method: 'GET', url: '/api/payhub/rp-auto-create' });
    expect(res.statusCode).toBe(401);
  });

  it('GET admin: настройки нет в БД -> включено', async () => {
    const app = await buildApp({ value: null });
    const token = await seedAndSign(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/payhub/rp-auto-create',
      cookies: { access_token: token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true });
  });

  it('PUT не-admin -> 403, значение не меняется', async () => {
    const state: FakeState = { value: { enabled: true } };
    const app = await buildApp(state);
    const token = await seedAndSign(app, { id: 'user-1', email: 'u@example.com', role: 'user' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/payhub/rp-auto-create',
      cookies: { access_token: token },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(403);
    expect(state.value).toEqual({ enabled: true });
  });

  it('PUT admin выключает автосоздание; некорректное тело отклоняется', async () => {
    const state: FakeState = { value: null };
    const app = await buildApp(state);
    const token = await seedAndSign(app);
    const ok = await app.inject({
      method: 'PUT',
      url: '/api/payhub/rp-auto-create',
      cookies: { access_token: token },
      payload: { enabled: false },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ enabled: false });
    expect(state.value).toEqual({ enabled: false });

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/payhub/rp-auto-create',
      cookies: { access_token: token },
      payload: { enabled: 'yes' },
    });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(state.value).toEqual({ enabled: false });
  });
});
