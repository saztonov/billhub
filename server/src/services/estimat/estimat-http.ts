/**
 * Низкоуровневый HTTP-транспорт исходящего канала событий BillHub → EstiMat.
 * Авторизация — Authorization: Api-Key <token> (контракт EstiMat, НЕ Bearer).
 *
 * Политика ретраев (отправка события идемпотентна по eventId на приёмнике — повтор безопасен):
 *   - сеть/таймаут/5xx/429 — ретрай (с учётом Retry-After);
 *   - 409 «заявка не найдена, повторите позже» — временная, повтор позже (код not_found);
 *   - 409 иной (тот же eventId с другим телом) — конфликт, без ретраев;
 *   - 401 — api_key_invalid; 400 — validation_error.
 * В логи — только метод/путь/статус/попытка; токен и тела не логируются.
 */
import type { Logger } from 'pino';
import { EstimatApiError, type EstimatErrorCode } from './estimat-errors.js';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;
const MAX_RETRY_AFTER_MS = 30_000;

export interface EstimatHttpConfig {
  /** Origin EstiMat без пути (нормализованный, без трейлинг-слэша). */
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

/** Разбор ответа-ошибки: EstiMat отдаёт {error: string} либо {error:{code,message}}. */
async function parseError(response: Response): Promise<{ code: string; message: string }> {
  const fallback = { code: 'unknown', message: `EstiMat HTTP ${response.status}` };
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (parsed && typeof parsed.error === 'object' && parsed.error !== null) {
        const e = parsed.error as { code?: unknown; message?: unknown };
        return {
          code: typeof e.code === 'string' ? e.code : 'unknown',
          message: typeof e.message === 'string' ? e.message : fallback.message,
        };
      }
      if (typeof parsed.error === 'string') return { code: 'unknown', message: parsed.error };
      return fallback;
    } catch {
      return { code: 'unknown', message: `${fallback.message}: ${text.slice(0, 200)}` };
    }
  } catch {
    return fallback;
  }
}

export class EstimatHttp {
  constructor(private readonly cfg: EstimatHttpConfig) {}

  /** POST JSON на абсолютный путь EstiMat (например, /api/integration/events). */
  async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.cfg.baseUrl}${path}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let response: Response;
      try {
        response = await this.cfg.fetchImpl(url, {
          method: 'POST',
          redirect: 'error',
          headers: {
            Authorization: `Api-Key ${this.cfg.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.cfg.timeoutMs),
        });
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRIES) {
          this.cfg.logger.warn({ path, attempt: attempt + 1 }, 'EstiMat: сетевая ошибка, повтор');
          await sleep(backoffMs(attempt, null));
          continue;
        }
        throw new EstimatApiError(0, 'unknown', 'EstiMat недоступен (сеть/таймаут)', true);
      }

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }

      // 409 «повторите позже» — временная (событие раньше ответа submit).
      const { code, message } = await parseError(response);
      const isRetryLater = response.status === 409 && /не найден|later|позже/i.test(message);
      const retryableHttp = response.status === 429 || response.status >= 500 || isRetryLater;

      if (retryableHttp && attempt < MAX_RETRIES) {
        this.cfg.logger.warn(
          { path, status: response.status, attempt: attempt + 1 },
          'EstiMat: повтор после ошибки',
        );
        await sleep(backoffMs(attempt, response.headers.get('retry-after')));
        continue;
      }

      const mappedCode: EstimatErrorCode = isRetryLater
        ? 'not_found'
        : response.status === 409
          ? 'conflict'
          : response.status === 401
            ? 'api_key_invalid'
            : response.status === 400
              ? 'validation_error'
              : 'unknown';
      this.cfg.logger.error({ path, status: response.status, code }, 'EstiMat: ошибка API');
      throw new EstimatApiError(response.status, mappedCode, message, isRetryLater);
    }

    throw lastError instanceof Error ? lastError : new Error('EstiMat: запрос не выполнен');
  }
}
