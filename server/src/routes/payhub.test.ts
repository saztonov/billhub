/**
 * Тесты роута GET /api/payhub/status через fastify.inject (без Docker, in-memory auth).
 * Клиент PayHub декорируется вручную с инжектированным fetch — как это делает
 * плагин plugins/payhub.ts, но с управляемыми ответами.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import authPlugin from '../plugins/auth.js';
import payhubRoutes from './payhub.js';
import { createPayHubClient, type PayHubClient } from '../services/payhub/payhub-client.js';
import { _clearUserCache } from '../middleware/authenticate.js';
import { InMemoryUserAuthStore } from '../services/auth/stores/memory.js';
import type { UserAuthRecord } from '../services/auth/stores/types.js';

const BASE = 'https://payhub.example.ru';

/** Приложение с in-memory auth и заданным состоянием интеграции PayHub */
async function buildApp(payhub: PayHubClient | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authPlugin);
  app.decorate('payhub', payhub);
  await app.register(payhubRoutes);
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

/** Заводит пользователя и выпускает access-токен (cookie для inject) */
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

/** Клиент PayHub с фиксированным ответом ping */
function clientWithResponse(response: Response | (() => never)): PayHubClient {
  const fetchImpl = (async () => {
    if (typeof response === 'function') return response();
    return response;
  }) as unknown as typeof fetch;
  return createPayHubClient({ baseUrl: BASE, token: 'test-token', fetchImpl });
}

describe('GET /api/payhub/status', () => {
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
    const app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/api/payhub/status' });
    expect(res.statusCode).toBe(401);
  });

  it('не-admin -> 403', async () => {
    const app = await buildApp(null);
    const token = await seedAndSign(app, { id: 'user-1', email: 'u@example.com', role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/payhub/status',
      cookies: { access_token: token },
    });
    expect(res.statusCode).toBe(403);
  });

  it('интеграция не настроена -> configured:false без обращения к PayHub', async () => {
    const app = await buildApp(null);
    const token = await seedAndSign(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/payhub/status',
      cookies: { access_token: token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false, ok: false });
  });

  it('настроено, PayHub отвечает -> ok:true с baseUrl и latencyMs', async () => {
    const client = clientWithResponse(
      new Response(JSON.stringify({ statuses: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const app = await buildApp(client);
    const token = await seedAndSign(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/payhub/status',
      cookies: { access_token: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.baseUrl).toBe(BASE);
    expect(typeof body.latencyMs).toBe('number');
  });

  it('настроено, PayHub возвращает 401 -> ok:false с кодом api_key_invalid', async () => {
    const client = clientWithResponse(
      new Response(
        JSON.stringify({ error: { code: 'api_key_invalid', message: 'ключ отозван' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const app = await buildApp(client);
    const token = await seedAndSign(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/payhub/status',
      cookies: { access_token: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      configured: true,
      ok: false,
      baseUrl: BASE,
      error: { code: 'api_key_invalid', httpStatus: 401, message: 'ключ отозван' },
    });
  });

  it('настроено, сетевая ошибка -> ok:false с кодом network_error', async () => {
    // ping идёт без ретраев — сетевая ошибка отдаётся сразу, таймеры не нужны
    const client = clientWithResponse(() => {
      throw new TypeError('fetch failed');
    });
    const app = await buildApp(client);
    const token = await seedAndSign(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/payhub/status',
      cookies: { access_token: token },
    });
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('network_error');
  });
});
