/**
 * Тесты POST /api/users и PUT /api/users/:id/sites через fastify.inject
 * (без Docker: in-memory auth + in-memory репозиторий пользователей).
 *
 * Покрывают два регресса:
 *  - занятый логин отдаётся как 409 с понятным текстом, а не сырым SQL-запросом;
 *  - правило «Штаба» (1..SHTAB_MAX_SITES объектов) проверяется на сервере, а не только в UI.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import authPlugin from '../plugins/auth.js';
import userRoutes from './users.js';
import { _clearUserCache } from '../middleware/authenticate.js';
import { InMemoryUserAuthStore } from '../services/auth/stores/memory.js';
import type { UserAuthRecord } from '../services/auth/stores/types.js';
import { InMemoryUserRepository } from '../test/repositories/in-memory.js';
import {
  UniqueConstraintError,
  ValidationError,
  NotFoundError,
  ForeignKeyConstraintError,
  ConflictError,
} from '../repositories/types.js';
import { SHTAB_MAX_SITES } from '../repositories/user-site-rules.js';

const PASSWORD = 'strong-password-123';

/** Приложение с in-memory auth и подменённым repos.users. */
async function buildApp(): Promise<{ app: FastifyInstance; repo: InMemoryUserRepository }> {
  const app = Fastify({ logger: false });
  // Тот же маппинг доменных ошибок, что и в app.ts — иначе тест проверял бы не то поведение.
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err.validation) return reply.status(400).send({ error: err.message });
    if (err instanceof ValidationError) return reply.status(400).send({ error: err.message });
    if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
    if (
      err instanceof UniqueConstraintError ||
      err instanceof ForeignKeyConstraintError ||
      err instanceof ConflictError
    ) {
      return reply.status(409).send({ error: err.message });
    }
    const sc = err.statusCode;
    if (sc && sc >= 400 && sc < 500) return reply.status(sc).send({ error: err.message });
    return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
  });
  await app.register(cookie);
  await app.register(authPlugin);
  const repo = new InMemoryUserRepository();
  app.decorate('repos', { users: repo } as unknown as FastifyInstance['repos']);
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.ready();
  return { app, repo };
}

function adminRecord(): UserAuthRecord {
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
  };
}

/** Заводит админа в auth-хранилище и выпускает access-токен для inject. */
async function signAdmin(app: FastifyInstance): Promise<string> {
  const record = adminRecord();
  (app.authServices.users as InMemoryUserAuthStore).upsert(record);
  const { token } = await app.authServices.tokens.signAccess({
    sub: record.id,
    role: record.role,
    email: record.email,
  });
  return token;
}

function createBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: 'new.user@su10.ru',
    password: PASSWORD,
    fullName: 'Новый Пользователь',
    role: 'user',
    departmentId: 'omts',
    allSites: true,
    siteIds: [],
    ...over,
  };
}

const sites = (n: number): string[] => Array.from({ length: n }, (_, i) => `site-${i}`);

describe('POST /api/users', () => {
  let savedMode: string | undefined;
  let app: FastifyInstance;
  let repo: InMemoryUserRepository;
  let token: string;

  beforeAll(() => {
    savedMode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = 'standalone';
  });
  afterAll(() => {
    if (savedMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = savedMode;
  });

  beforeEach(async () => {
    _clearUserCache();
    ({ app, repo } = await buildApp());
    token = await signAdmin(app);
  });

  const post = (body: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { access_token: token },
      payload: body,
    });

  it('создаёт пользователя', async () => {
    const res = await post(createBody());
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(await repo.findByEmail('new.user@su10.ru')).not.toBeNull();
  });

  it('занятый email -> 409 без текста SQL-запроса', async () => {
    await post(createBody());
    const res = await post(createBody());
    expect(res.statusCode).toBe(409);
    const error = res.json().error as string;
    expect(error).toBe('Пользователь с email new.user@su10.ru уже существует');
    expect(error).not.toContain('insert into');
    expect(error).not.toContain('params:');
  });

  it(`Штаб: больше ${SHTAB_MAX_SITES} объектов -> 400`, async () => {
    const res = await post(
      createBody({ departmentId: 'shtab', allSites: false, siteIds: sites(SHTAB_MAX_SITES + 1) }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain(String(SHTAB_MAX_SITES));
    expect(await repo.findByEmail('new.user@su10.ru')).toBeNull();
  });

  it('Штаб без объектов -> 400', async () => {
    const res = await post(createBody({ departmentId: 'shtab', allSites: false, siteIds: [] }));
    expect(res.statusCode).toBe(400);
    expect(await repo.findByEmail('new.user@su10.ru')).toBeNull();
  });

  it(`Штаб: ровно ${SHTAB_MAX_SITES} объектов -> успех`, async () => {
    const res = await post(
      createBody({ departmentId: 'shtab', allSites: false, siteIds: sites(SHTAB_MAX_SITES) }),
    );
    expect(res.statusCode).toBe(200);
    const created = await repo.findByEmail('new.user@su10.ru');
    expect(created).not.toBeNull();
    const access = await repo.getSiteAccess(created!.id);
    expect(access.siteIds).toHaveLength(SHTAB_MAX_SITES);
  });
});

describe('PUT /api/users/:id/sites', () => {
  let savedMode: string | undefined;
  let app: FastifyInstance;
  let repo: InMemoryUserRepository;
  let token: string;

  beforeAll(() => {
    savedMode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = 'standalone';
  });
  afterAll(() => {
    if (savedMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = savedMode;
  });

  beforeEach(async () => {
    _clearUserCache();
    ({ app, repo } = await buildApp());
    token = await signAdmin(app);
    repo.seed([
      {
        id: 'shtab-1',
        email: 'shtab@su10.ru',
        fullName: 'Сотрудник штаба',
        role: 'user',
        counterpartyId: null,
        department: 'shtab',
        allSites: false,
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  const put = (siteIds: string[]) =>
    app.inject({
      method: 'PUT',
      url: '/api/users/shtab-1/sites',
      cookies: { access_token: token },
      payload: { siteIds },
    });

  it(`принимает ${SHTAB_MAX_SITES} объектов`, async () => {
    const res = await put(sites(SHTAB_MAX_SITES));
    expect(res.statusCode).toBe(200);
    expect((await repo.getSiteAccess('shtab-1')).siteIds).toHaveLength(SHTAB_MAX_SITES);
  });

  it('отклоняет превышение лимита в обход UI -> 400', async () => {
    const res = await put(sites(SHTAB_MAX_SITES + 1));
    expect(res.statusCode).toBe(400);
    expect((await repo.getSiteAccess('shtab-1')).siteIds).toHaveLength(0);
  });
});
