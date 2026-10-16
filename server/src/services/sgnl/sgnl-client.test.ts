/**
 * Юнит-тесты клиента SIGNAL: токен (кэш, перевыпуск, ошибки scopes), ретраи 429/5xx,
 * пагинация, пятишаговая загрузка файла. Транспорт — инжектируемый fetch, без пауз.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSgnlClient, normalizeBaseUrl } from './sgnl-client.js';
import { SgnlApiError, SgnlAuthError, isFatalSgnlError } from './sgnl-errors.js';

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Мок fetch: ответы по очереди, вызовы захватываются */
function makeFetchMock(responses: Array<Response | (() => Response)>) {
  const calls: CapturedCall[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error('Мок fetch: ответы закончились');
    return typeof next === 'function' ? next() : next;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const tokenOk = () => json({ token: 'jwt-1', expiresIn: 3600 });
const BASE = 'https://api.sgnl.test';

function makeClient(responses: Array<Response | (() => Response)>, now?: () => number) {
  const mock = makeFetchMock(responses);
  const sleep = vi.fn(async () => {});
  const client = createSgnlClient({
    baseUrl: BASE,
    clientId: 'client-1',
    clientSecret: 'secret-1',
    fetchImpl: mock.fetchImpl,
    minIntervalMs: 0,
    sleep,
    now,
  });
  return { client, ...mock, sleep };
}

describe('normalizeBaseUrl', () => {
  it('оставляет origin и отбрасывает трейлинг-слэш', () => {
    expect(normalizeBaseUrl('https://api.sgnl.pro/')).toBe('https://api.sgnl.pro');
  });
  it('отклоняет путь и не-http протокол', () => {
    expect(() => normalizeBaseUrl('https://api.sgnl.pro/public')).toThrow();
    expect(() => normalizeBaseUrl('ftp://api.sgnl.pro')).toThrow();
  });
});

describe('SgnlClient: токен', () => {
  it('получает токен с clientId/secret/scopes и использует Bearer; токен кэшируется', async () => {
    const { client, calls } = makeClient([
      tokenOk(),
      json([]),
      json({ id: 'r', name: 'Root', children: [] }),
    ]);
    await client.listProjects();
    await client.getFolderTree('p1');

    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toBe(`${BASE}/public/v1/auth/token`);
    const authBody = JSON.parse(calls[0]!.body!);
    expect(authBody.clientId).toBe('client-1');
    expect(authBody.clientSecret).toBe('secret-1');
    expect(authBody.scopes).toContain('project:list');
    expect(calls[1]!.headers.Authorization).toBe('Bearer jwt-1');
    expect(calls[2]!.url).toBe(`${BASE}/public/v1/projects/p1/folders/tree`);
  });

  it('перевыпускает токен перед истечением', async () => {
    let t = 0;
    const { client, calls } = makeClient(
      [tokenOk(), json([]), json({ token: 'jwt-2', expiresIn: 3600 }), json([])],
      () => t,
    );
    await client.listProjects();
    t = 3600 * 1000 - 30_000; // за 30 с до истечения — внутри запаса
    await client.listProjects();
    expect(calls.filter((c) => c.url.endsWith('/auth/token'))).toHaveLength(2);
    expect(calls[3]!.headers.Authorization).toBe('Bearer jwt-2');
  });

  it('на 401 сбрасывает токен и повторяет запрос один раз', async () => {
    const { client, calls } = makeClient([
      tokenOk(),
      new Response('', { status: 401 }),
      json({ token: 'jwt-2', expiresIn: 3600 }),
      json([{ id: 'p', name: 'P', code: '' }]),
    ]);
    const projects = await client.listProjects();
    expect(projects).toHaveLength(1);
    expect(calls[3]!.headers.Authorization).toBe('Bearer jwt-2');
  });

  it('ScopeError → SgnlAuthError (фатальная для прогона)', async () => {
    const { client } = makeClient([json('ScopeError', 422)]);
    const error = await client.checkWriteAccess().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SgnlAuthError);
    expect((error as SgnlAuthError).code).toBe('ScopeError');
    expect(isFatalSgnlError(error)).toBe(true);
  });
});

describe('SgnlClient: ретраи и ошибки', () => {
  it('429 повторяется с учётом Retry-After', async () => {
    const { client, sleep } = makeClient([
      tokenOk(),
      new Response('', { status: 429, headers: { 'retry-after': '2' } }),
      json([]),
    ]);
    await client.listProjects();
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('5xx повторяется для GET', async () => {
    const { client, calls } = makeClient([tokenOk(), new Response('', { status: 550 }), json([])]);
    await client.listFolderItems('f1');
    expect(calls).toHaveLength(3);
  });

  it('5xx при создании item не повторяется (защита от дубля)', async () => {
    const { client, calls } = makeClient([tokenOk(), json({ message: 'boom' }, 500)]);
    const error = await client.createFileItem('f1', 'a.pdf', 'v1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SgnlApiError);
    expect((error as SgnlApiError).status).toBe(500);
    expect((error as SgnlApiError).message).toBe('boom');
    expect(calls).toHaveLength(2);
  });
});

describe('SgnlClient: данные', () => {
  it('listFolderItems листает страницы по 200 и не запрашивает удалённые', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => ({
      id: `i${i}`,
      name: `${i}`,
      type: 'File',
      deleted: false,
    }));
    const { client, calls } = makeClient([
      tokenOk(),
      json(page1),
      json([{ id: 'x', name: 'x', type: 'File', deleted: false }]),
    ]);
    const items = await client.listFolderItems('f1');
    expect(items).toHaveLength(201);
    const second = new URL(calls[2]!.url);
    expect(second.searchParams.get('Skip')).toBe('200');
    expect(second.searchParams.get('deleted')).toBe('false');
    expect(second.searchParams.get('folderId')).toBe('f1');
  });

  it('загрузка файла: тикет → PUT signed URL → commit → версия → item', async () => {
    const { client, calls } = makeClient([
      tokenOk(),
      json({ objectId: 'obj-1', signedUrl: 'https://s3.sgnl.test/put?sig=1', ttlSec: 600 }),
      new Response('', { status: 200 }),
      new Response('', { status: 200 }),
      json({ data: 'ver-1' }),
      json({ data: 'item-1' }),
    ]);
    const body = Buffer.from('%PDF-1.4');
    const { objectId, versionId } = await client.uploadVersion({
      projectId: 'p1',
      folderId: 'f1',
      name: '12_счёт.pdf',
      mimeType: 'application/pdf',
      body,
    });
    const itemId = await client.createFileItem('f1', '12_счёт.pdf', versionId);

    expect({ objectId, versionId, itemId }).toEqual({
      objectId: 'obj-1',
      versionId: 'ver-1',
      itemId: 'item-1',
    });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'POST /public/v1/auth/token',
      'PUT /public/v1/objects',
      'PUT /put',
      'POST /public/v1/objects/obj-1/uploading/commit',
      'POST /public/v1/versions',
      'PUT /public/v1/items/file',
    ]);
    expect(JSON.parse(calls[1]!.body!)).toEqual({
      projectId: 'p1',
      mimeType: 'application/pdf',
      size: body.length,
    });
    // В signed URL Bearer не передаётся
    expect(calls[2]!.headers.Authorization).toBeUndefined();
    expect(calls[2]!.headers['Content-Type']).toBe('application/pdf');
    expect(JSON.parse(calls[4]!.body!)).toEqual({
      objectId: 'obj-1',
      projectId: 'p1',
      name: '12_счёт.pdf',
    });
    expect(JSON.parse(calls[5]!.body!)).toEqual({
      name: '12_счёт.pdf',
      folderId: 'f1',
      versionId: 'ver-1',
    });
    // Загрузка запрашивает токен со scope создания версий
    expect(JSON.parse(calls[0]!.body!).scopes).toContain('docs:version:create');
  });
});
