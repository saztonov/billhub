/**
 * Низкоуровневый HTTP-транспорт тендерного портала (Bearer). По образцу payhub-http.
 *
 * Ретраи:
 *   - 429 — для всех методов (с учётом Retry-After);
 *   - 5xx/сеть/таймаут — только для GET (мутации не повторяем: createTender по externalRef
 *     идемпотентен на стороне портала, но транспорт повтор не берёт на себя — доводит очередь);
 *   - прочие 4xx — сразу TenderApiError.
 * В логи — только метод/путь/статус/попытка.
 */
import type { Logger } from 'pino';
import { TenderApiError, toTenderErrorCode } from './tender-errors.js';

export const TENDER_API_PREFIX = '/api/external/v1';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;
const MAX_RETRY_AFTER_MS = 30_000;

export interface TenderRequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
}

export interface TenderHttpConfig {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  logger: Logger;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }
  }
  return INITIAL_BACKOFF_MS * Math.pow(2, attempt);
}

async function parseErrorBody(response: Response): Promise<{ code: string; message: string }> {
  const fallback = { code: 'unknown', message: `Tender HTTP ${response.status}` };
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
      const code = typeof parsed?.error?.code === 'string' ? parsed.error.code : 'unknown';
      const message =
        typeof parsed?.error?.message === 'string' && parsed.error.message.length > 0
          ? parsed.error.message
          : fallback.message;
      return { code, message };
    } catch {
      return { code: 'unknown', message: `${fallback.message}: ${text.slice(0, 200)}` };
    }
  } catch {
    return fallback;
  }
}

export class TenderHttp {
  constructor(private readonly cfg: TenderHttpConfig) {}

  async request<T>(method: string, path: string, options: TenderRequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const timeoutMs = options.timeoutMs ?? this.cfg.timeoutMs;
    const retries = options.retries ?? MAX_RETRIES;
    const retryOnServerError = method === 'GET';

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.token}`,
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let response: Response;
      try {
        response = await this.cfg.fetchImpl(url, {
          method,
          headers,
          redirect: 'error',
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastError = error;
        if (retryOnServerError && attempt < retries) {
          this.cfg.logger.warn(
            { method, path, attempt: attempt + 1 },
            'Tender: сетевая ошибка, повтор',
          );
          await sleep(backoffMs(attempt, null));
          continue;
        }
        this.cfg.logger.error({ method, path }, 'Tender: сетевая ошибка/таймаут');
        throw error;
      }

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }

      const retryable = response.status === 429 || (retryOnServerError && response.status >= 500);
      if (retryable && attempt < retries) {
        this.cfg.logger.warn(
          { method, path, status: response.status, attempt: attempt + 1 },
          'Tender: повтор после ошибки',
        );
        await sleep(backoffMs(attempt, response.headers.get('retry-after')));
        continue;
      }

      const { code, message } = await parseErrorBody(response);
      this.cfg.logger.error({ method, path, status: response.status, code }, 'Tender: ошибка API');
      throw new TenderApiError(response.status, toTenderErrorCode(code), message);
    }

    throw lastError instanceof Error ? lastError : new Error('Tender: запрос не выполнен');
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(`${this.cfg.baseUrl}${TENDER_API_PREFIX}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}
