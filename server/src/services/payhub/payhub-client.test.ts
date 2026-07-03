/**
 * Юнит-тесты клиента PayHub: сборка URL/заголовков, разбор ответов,
 * маппинг ошибок, политика ретраев, трёхшаговая загрузка вложений.
 * Транспорт подменяется через инжектируемый fetch (без stubGlobal).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPayHubClient,
  createPayHubClientFromEnv,
  normalizeBaseUrl,
  PAYHUB_MAX_ATTACHMENT_BYTES,
} from './payhub-client.js';
import { PayHubApiError } from './payhub-errors.js';
import { config } from '../../config.js';

/** Захваченный вызов fetch */
interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Мок fetch: отдаёт ответы по очереди, захватывает вызовы */
function makeFetchMock(responses: Response[]) {
  const calls: CapturedCall[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const response = responses.shift();
    if (!response) throw new Error('Мок fetch: ответы закончились');
    return response;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function errorResponse(
  status: number,
  code: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: { code, message: `тест: ${code}` } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const BASE = 'https://payhub.example.ru';
const TOKEN = 'test-token';

function makeClient(responses: Response[]) {
  const { fetchImpl, calls } = makeFetchMock(responses);
  const client = createPayHubClient({ baseUrl: BASE, token: TOKEN, fetchImpl });
  return { client, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('normalizeBaseUrl', () => {
  it('нормализует трейлинг-слэш', () => {
    expect(normalizeBaseUrl('https://payhub.example.ru/')).toBe('https://payhub.example.ru');
  });

  it('отклоняет невалидный URL', () => {
    expect(() => normalizeBaseUrl('не-url')).toThrow(/не является корректным URL/);
  });

  it('отклоняет URL с путём', () => {
    expect(() => normalizeBaseUrl('https://payhub.example.ru/api')).toThrow(/origin без пути/);
  });

  it('отклоняет не-http протокол', () => {
    expect(() => normalizeBaseUrl('ftp://payhub.example.ru')).toThrow(/http\/https/);
  });
});

describe('createPayHubClientFromEnv', () => {
  it('возвращает null при незаданных переменных, клиент — при заданных', () => {
    const original = {
      baseUrl: config.payhubBaseUrl,
      token: config.payhubApiToken,
    };
    try {
      config.payhubBaseUrl = '';
      config.payhubApiToken = '';
      expect(createPayHubClientFromEnv()).toBeNull();

      config.payhubBaseUrl = BASE;
      config.payhubApiToken = '';
      expect(createPayHubClientFromEnv()).toBeNull();

      config.payhubApiToken = TOKEN;
      expect(createPayHubClientFromEnv()).not.toBeNull();
    } finally {
      config.payhubBaseUrl = original.baseUrl;
      config.payhubApiToken = original.token;
    }
  });
});

describe('PayHubClient: справочники', () => {
  it('listProjects: собирает URL с префиксом и Bearer, разворачивает {projects}', async () => {
    const { client, calls } = makeClient([
      jsonResponse({ projects: [{ id: 12, code: 'СУ10', name: 'Объект' }] }),
    ]);
    const projects = await client.listProjects();

    expect(projects).toEqual([{ id: 12, code: 'СУ10', name: 'Объект' }]);
    expect(calls[0]!.url).toBe(`${BASE}/api/external/v1/catalog/projects`);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('listLetterStatuses: разворачивает альтернативный ключ {statuses}', async () => {
    const { client } = makeClient([jsonResponse({ statuses: [{ id: 1, name: 'Новое' }] })]);
    expect(await client.listLetterStatuses()).toEqual([{ id: 1, name: 'Новое' }]);
  });
});

describe('PayHubClient: письма', () => {
  it('createLetter: POST с телом и share при ensure_share', async () => {
    const letter = { id: 'abc', project_id: 12, direction: 'incoming', letter_date: '2026-07-03' };
    const share = { share_url: 'https://payhub.example.ru/s/t1', token: 't1' };
    const { client, calls } = makeClient([jsonResponse({ letter, share })]);

    const result = await client.createLetter({
      project_id: 12,
      direction: 'incoming',
      letter_date: '2026-07-03',
      number: 'ВХ-123',
      ensure_share: true,
    });

    expect(result.letter.id).toBe('abc');
    expect(result.share?.share_url).toBe(share.share_url);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe(`${BASE}/api/external/v1/letters`);
    expect(calls[0]!.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0]!.body ?? '{}')).toMatchObject({
      number: 'ВХ-123',
      ensure_share: true,
    });
  });

  it('listLetters: query-параметры, undefined пропускаются', async () => {
    const { client, calls } = makeClient([jsonResponse({ letters: [], total: 0 })]);
    const result = await client.listLetters({ reg_number: 'СУ10-ВХ-2607-0001', limit: 10 });

    expect(result).toEqual({ letters: [], total: 0 });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/api/external/v1/letters');
    expect(url.searchParams.get('reg_number')).toBe('СУ10-ВХ-2607-0001');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.has('number')).toBe(false);
    expect(url.searchParams.has('offset')).toBe(false);
  });

  it('lookupLetter: 409 -> PayHubApiError ambiguous_letter_lookup', async () => {
    const { client } = makeClient([errorResponse(409, 'ambiguous_letter_lookup')]);
    const error = await client.lookupLetter({ number: 'ВХ-1' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayHubApiError);
    expect((error as PayHubApiError).status).toBe(409);
    expect((error as PayHubApiError).code).toBe('ambiguous_letter_lookup');
  });

  it('updateLetter: 403 -> not_owner', async () => {
    const { client } = makeClient([errorResponse(403, 'not_owner')]);
    const error = await client.updateLetter('abc', { subject: 'x' }).catch((e: unknown) => e);
    expect((error as PayHubApiError).code).toBe('not_owner');
  });

  it('getLetter: 404 -> not_found; 401 -> api_key_invalid', async () => {
    const { client } = makeClient([
      errorResponse(404, 'not_found'),
      errorResponse(401, 'api_key_invalid'),
    ]);
    const notFound = (await client.getLetter('x').catch((e: unknown) => e)) as PayHubApiError;
    expect(notFound.code).toBe('not_found');
    const unauthorized = (await client.getLetter('x').catch((e: unknown) => e)) as PayHubApiError;
    expect(unauthorized.code).toBe('api_key_invalid');
    expect(unauthorized.status).toBe(401);
  });

  it('неизвестный код ошибки -> unknown', async () => {
    const { client } = makeClient([errorResponse(400, 'какая-то-новая-ошибка')]);
    const error = (await client.getLetter('x').catch((e: unknown) => e)) as PayHubApiError;
    expect(error.code).toBe('unknown');
    expect(error.status).toBe(400);
  });
});

describe('PayHubClient: ретраи', () => {
  it('429 ретраится для POST с учётом Retry-After', async () => {
    const letter = { id: 'abc', project_id: 1, direction: 'outgoing', letter_date: '2026-07-03' };
    const { client, calls } = makeClient([
      errorResponse(429, 'rate_limited', { 'Retry-After': '0' }),
      jsonResponse({ letter }),
    ]);
    const result = await client.createLetter({
      project_id: 1,
      direction: 'outgoing',
      letter_date: '2026-07-03',
    });
    expect(result.letter.id).toBe('abc');
    expect(calls.length).toBe(2);
  });

  it('500 на GET ретраится с backoff', async () => {
    vi.useFakeTimers();
    const { client, calls } = makeClient([
      errorResponse(500, 'internal'),
      jsonResponse({ projects: [] }),
    ]);
    const promise = client.listProjects();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await promise).toEqual([]);
    expect(calls.length).toBe(2);
  });

  it('500 на POST НЕ ретраится (риск дубликата письма)', async () => {
    const { client, calls } = makeClient([errorResponse(500, 'internal')]);
    const error = await client
      .createLetter({ project_id: 1, direction: 'incoming', letter_date: '2026-07-03' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayHubApiError);
    expect((error as PayHubApiError).status).toBe(500);
    expect(calls.length).toBe(1);
  });

  it('ping: без ретраев даже при 429', async () => {
    const { client, calls } = makeClient([errorResponse(429, 'rate_limited')]);
    const error = await client.ping().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayHubApiError);
    expect(calls.length).toBe(1);
  });

  it('сетевая ошибка на GET ретраится, после исчерпания попыток пробрасывается', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const client = createPayHubClient({ baseUrl: BASE, token: TOKEN, fetchImpl });
    const promise = client.listProjects().catch((e: unknown) => e);
    // Backoff: 2000 + 4000 + 8000
    await vi.advanceTimersByTimeAsync(14_000);
    const error = await promise;
    expect(error).toBeInstanceOf(TypeError);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
  });
});

describe('PayHubClient: вложения', () => {
  it('uploadAttachment: presign -> PUT без Bearer -> привязка', async () => {
    const presign = {
      url: 'https://s3.payhub.example.ru/bucket/key?signature=abc',
      headers: { 'Content-Type': 'application/pdf' },
      storage_path: 'letters/abc/file.pdf',
    };
    const { client, calls } = makeClient([
      jsonResponse(presign),
      new Response(null, { status: 200 }),
      jsonResponse({ id: 'att-1' }, 201),
    ]);

    const bytes = Buffer.from('тестовый файл');
    const result = await client.uploadAttachment('abc', {
      name: 'file.pdf',
      bytes,
      mime_type: 'application/pdf',
    });

    expect(result.id).toBe('att-1');
    // Шаг 1: presign
    expect(calls[0]!.url).toBe(`${BASE}/api/external/v1/letters/abc/attachments/presign-upload`);
    expect(JSON.parse(calls[0]!.body ?? '{}')).toEqual({
      file_name: 'file.pdf',
      content_type: 'application/pdf',
      size_bytes: bytes.byteLength,
    });
    // Шаг 2: PUT напрямую в S3 — заголовки из presign, БЕЗ Authorization
    expect(calls[1]!.url).toBe(presign.url);
    expect(calls[1]!.method).toBe('PUT');
    expect(calls[1]!.headers.Authorization).toBeUndefined();
    expect(calls[1]!.headers['Content-Type']).toBe('application/pdf');
    // Шаг 3: привязка
    expect(calls[2]!.url).toBe(`${BASE}/api/external/v1/letters/abc/attachments`);
    expect(JSON.parse(calls[2]!.body ?? '{}')).toEqual({
      original_name: 'file.pdf',
      storage_path: presign.storage_path,
      size_bytes: bytes.byteLength,
      mime_type: 'application/pdf',
    });
  });

  it('отклоняет файл больше 300 МБ до обращения к API', async () => {
    const { client, calls } = makeClient([]);
    const oversized = { byteLength: PAYHUB_MAX_ATTACHMENT_BYTES + 1 } as unknown as Buffer;
    await expect(
      client.uploadAttachment('abc', { name: 'big.bin', bytes: oversized }),
    ).rejects.toThrow(/300 МБ/);
    expect(calls.length).toBe(0);
  });

  it('ошибка PUT в S3 пробрасывается без ретрая', async () => {
    const presign = { url: 'https://s3.example/k', headers: {}, storage_path: 'p' };
    const { client, calls } = makeClient([
      jsonResponse(presign),
      new Response('denied', { status: 403 }),
    ]);
    await expect(
      client.uploadAttachment('abc', { name: 'f.bin', bytes: Buffer.from('x') }),
    ).rejects.toThrow(/HTTP 403/);
    expect(calls.length).toBe(2);
  });
});
