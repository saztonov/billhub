/**
 * Интеграционные тесты standalone-auth через fastify.inject (без Docker, in-memory хранилища).
 * Покрывают: login/refresh/logout/me, смену пароля, password reset, CSRF (403), rate-limit (429),
 * и диспетчеризацию по AUTH_MODE (standalone vs supabase-bridge).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import csrfPlugin from '../plugins/csrf.js';
import authPlugin from '../plugins/auth.js';
import authRoutes from './auth.js';
import { ValidationError } from '../repositories/types.js';
import { InMemoryUserAuthStore } from '../services/auth/stores/memory.js';
import type { UserAuthRecord } from '../services/auth/stores/types.js';

const PASSWORD = 'admin-password-123';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err.validation) return reply.status(400).send({ error: err.message });
    if (err instanceof ValidationError) return reply.status(400).send({ error: err.message });
    const sc = err.statusCode;
    if (sc && sc >= 400 && sc < 500) return reply.status(sc).send({ error: err.message });
    return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
  });
  await app.register(cookie);
  await app.register(csrfPlugin);
  await app.register(authPlugin);
  await app.register(authRoutes);
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

async function seed(app: FastifyInstance, over: Partial<UserAuthRecord> = {}): Promise<void> {
  const hash = await app.authServices.passwords.hash(PASSWORD);
  (app.authServices.users as InMemoryUserAuthStore).upsert(rec({ passwordHash: hash, ...over }));
}

function cookieVal(
  res: { cookies: { name: string; value: string }[] },
  name: string,
): string | undefined {
  return res.cookies.find((c) => c.name === name)?.value;
}

/** Все Set-Cookie с данным именем (для проверки очистки refresh_token сразу по двум путям). */
function cookiesByName(
  res: { cookies: { name: string; value: string; path?: string; maxAge?: number }[] },
  name: string,
): { name: string; value: string; path?: string; maxAge?: number }[] {
  return res.cookies.filter((c) => c.name === name);
}

async function getCsrf(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
  return cookieVal(res, 'csrf_token')!;
}

describe('standalone auth routes', () => {
  let savedMode: string | undefined;
  let savedMail: string | undefined;
  let dir: string;

  beforeAll(() => {
    savedMode = process.env.AUTH_MODE;
    savedMail = process.env.MAIL_STUB_LOG_PATH;
    process.env.AUTH_MODE = 'standalone';
    dir = mkdtempSync(path.join(tmpdir(), 'auth-'));
    process.env.MAIL_STUB_LOG_PATH = path.join(dir, 'mail-stub.log');
  });
  afterAll(() => {
    if (savedMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = savedMode;
    if (savedMail === undefined) delete process.env.MAIL_STUB_LOG_PATH;
    else process.env.MAIL_STUB_LOG_PATH = savedMail;
    rmSync(dir, { recursive: true, force: true });
  });

  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp();
    await seed(app);
  });

  it('login с верным паролем → 200 + cookies access_token/refresh_token', async () => {
    const csrf = await getCsrf(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      cookies: { csrf_token: csrf },
      headers: { 'x-csrf-token': csrf },
      payload: { email: 'admin@example.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe('admin@example.com');
    expect(body.user.role).toBe('admin');
    expect(cookieVal(res, 'access_token')).toBeTruthy();
    expect(cookieVal(res, 'refresh_token')).toBeTruthy();
  });

  it('login с неверным паролем → 401', async () => {
    const csrf = await getCsrf(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      cookies: { csrf_token: csrf },
      headers: { 'x-csrf-token': csrf },
      payload: { email: 'admin@example.com', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('CSRF: POST без X-CSRF-Token → 403', async () => {
    const csrf = await getCsrf(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      cookies: { csrf_token: csrf }, // cookie есть, заголовка нет
      payload: { email: 'admin@example.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/auth/me возвращает профиль после логина', async () => {
    const csrf = await getCsrf(app);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      cookies: { csrf_token: csrf },
      headers: { 'x-csrf-token': csrf },
      payload: { email: 'admin@example.com', password: PASSWORD },
    });
    const access = cookieVal(login, 'access_token')!;
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { access_token: access },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('admin@example.com');
  });

  it('refresh ротирует токен (200 + новый refresh cookie)', async () => {
    const csrf = await getCsrf(app);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      cookies: { csrf_token: csrf },
      headers: { 'x-csrf-token': csrf },
      payload: { email: 'admin@example.com', password: PASSWORD },
    });
    const refresh = cookieVal(login, 'refresh_token')!;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { csrf_token: csrf, refresh_token: refresh },
      headers: { 'x-csrf-token': csrf },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(cookieVal(res, 'access_token')).toBeTruthy();
  });

  it('login чистит legacy refresh-cookie (/api/auth/refresh) и ставит standalone (/api/auth)', async () => {
    const csrf = await getCsrf(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      cookies: { csrf_token: csrf },
      headers: { 'x-csrf-token': csrf },
      payload: { email: 'admin@example.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const refreshCookies = cookiesByName(res, 'refresh_token');
    // Одна cookie — удаление legacy-пути (maxAge=0), вторая — новый standalone-токен на /api/auth.
    const legacyClear = refreshCookies.find((c) => c.path === '/api/auth/refresh');
    const standaloneSet = refreshCookies.find((c) => c.path === '/api/auth');
    expect(legacyClear).toBeTruthy();
    expect(legacyClear!.maxAge).toBe(0);
    expect(standaloneSet).toBeTruthy();
    expect(standaloneSet!.value).toBeTruthy();
  });

  it('refresh с невалидным (legacy-форматом) токеном → 401 + очистка refresh_token по ОБОИМ путям', async () => {
    const csrf = await getCsrf(app);
    // Короткий токен legacy-формата (не 43 символа base64url) — как «осиротевшая» supabase-cookie.
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { csrf_token: csrf, refresh_token: 'h6l4mbdodlqj' },
      headers: { 'x-csrf-token': csrf },
    });
    expect(res.statusCode).toBe(401);
    const cleared = cookiesByName(res, 'refresh_token');
    const paths = cleared.map((c) => c.path).sort();
    expect(paths).toContain('/api/auth');
    expect(paths).toContain('/api/auth/refresh');
    expect(cleared.every((c) => c.maxAge === 0)).toBe(true);
  });

  it('logout → 200 success', async () => {
    const csrf = await getCsrf(app);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      cookies: { csrf_token: csrf },
      headers: { 'x-csrf-token': csrf },
      payload: { email: 'admin@example.com', password: PASSWORD },
    });
    const refresh = cookieVal(login, 'refresh_token')!;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { csrf_token: csrf, refresh_token: refresh },
      headers: { 'x-csrf-token': csrf },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it('password reset: admin запрашивает токен → confirm → новый пароль работает', async () => {
    const csrf = await getCsrf(app);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      cookies: { csrf_token: csrf },
      headers: { 'x-csrf-token': csrf },
      payload: { email: 'admin@example.com', password: PASSWORD },
    });
    const access = cookieVal(login, 'access_token')!;

    const reqRes = await app.inject({
      method: 'POST',
      url: '/api/auth/password/reset/request',
      cookies: { csrf_token: csrf, access_token: access },
      headers: { 'x-csrf-token': csrf },
      payload: { email: 'admin@example.com' },
    });
    expect(reqRes.statusCode).toBe(200);
    const resetToken = reqRes.json().resetToken as string;
    expect(resetToken).toBeTruthy();

    const confirmRes = await app.inject({
      method: 'POST',
      url: '/api/auth/password/reset/confirm',
      cookies: { csrf_token: csrf },
      headers: { 'x-csrf-token': csrf },
      payload: { token: resetToken, newPassword: 'fresh-password-999' },
    });
    expect(confirmRes.statusCode).toBe(200);

    // старый пароль больше не работает, новый — работает
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      cookies: { csrf_token: csrf },
      headers: { 'x-csrf-token': csrf },
      payload: { email: 'admin@example.com', password: PASSWORD },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      cookies: { csrf_token: csrf },
      headers: { 'x-csrf-token': csrf },
      payload: { email: 'admin@example.com', password: 'fresh-password-999' },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('reset request требует роль admin (non-admin → 403)', async () => {
    await seed(app, { id: 'user-2', email: 'user@example.com', role: 'user' });
    const csrf = await getCsrf(app);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      cookies: { csrf_token: csrf },
      headers: { 'x-csrf-token': csrf },
      payload: { email: 'user@example.com', password: PASSWORD },
    });
    const access = cookieVal(login, 'access_token')!;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/reset/request',
      cookies: { csrf_token: csrf, access_token: access },
      headers: { 'x-csrf-token': csrf },
      payload: { email: 'admin@example.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rate-limit: 6-я попытка login в окне → 429', async () => {
    const csrf = await getCsrf(app);
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        cookies: { csrf_token: csrf },
        headers: { 'x-csrf-token': csrf },
        payload: { email: 'admin@example.com', password: 'wrong-password' },
      });
    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const r = await attempt();
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes[5]).toBe(429);
  }, 20_000);
});

describe('auth dispatcher — supabase-bridge', () => {
  let savedMode: string | undefined;
  beforeAll(() => {
    savedMode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = 'supabase-bridge';
  });
  afterAll(() => {
    if (savedMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = savedMode;
  });

  it('standalone-only endpoint отсутствует (404) в legacy-режиме', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/reset/request',
      payload: { email: 'x@e.com' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
