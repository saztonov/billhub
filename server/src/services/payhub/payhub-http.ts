/**
 * Низкоуровневый HTTP-транспорт внешнего API PayHub.
 *
 * Политика ретраев:
 *   - 429 — ретрай для всех методов (запрос отклонён до обработки), с учётом Retry-After;
 *   - 5xx и сетевые ошибки/таймауты — ретрай только для GET (мутации не повторяем:
 *     повтор POST /letters может создать дубликат письма);
 *   - остальные 4xx — сразу PayHubApiError без ретраев.
 *
 * В логи попадают только метод/путь/статус/номер попытки — токен и тела писем никогда.
 */
import type { Logger } from 'pino';
import { PayHubApiError, toPayHubErrorCode } from './payhub-errors.js';

/** Префикс внешнего API PayHub (при смене версии правится одно место) */
export const PAYHUB_API_PREFIX = '/api/external/v1';

/** Максимум повторных попыток и стартовый backoff (по образцу openrouter) */
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;
/** Потолок ожидания из Retry-After (мс) — защита от аномальных значений */
const MAX_RETRY_AFTER_MS = 30_000;

/** Параметры одного запроса */
export interface PayHubRequestOptions {
  /** Query-параметры; undefined-значения пропускаются */
  query?: Record<string, string | number | undefined>;
  /** JSON-тело запроса */
  body?: unknown;
  /** Переопределение таймаута (мс) */
  timeoutMs?: number;
  /** Переопределение числа ретраев (0 — без ретраев, для ping) */
  retries?: number;
}

export interface PayHubHttpConfig {
  /** Origin PayHub без пути (нормализованный, без трейлинг-слэша) */
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  logger: Logger;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Пауза перед повтором: Retry-After (секунды), иначе экспоненциальный backoff */
function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }
  }
  return INITIAL_BACKOFF_MS * Math.pow(2, attempt);
}

/** Извлечение {error:{code,message}} из тела ответа PayHub */
async function parseErrorBody(response: Response): Promise<{ code: string; message: string }> {
  const fallback = { code: 'unknown', message: `PayHub HTTP ${response.status}` };
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
      // Не JSON — вернём фрагмент сырого текста для диагностики
      return { code: 'unknown', message: `${fallback.message}: ${text.slice(0, 200)}` };
    }
  } catch {
    return fallback;
  }
}

/** HTTP-транспорт: сборка URL, заголовки, таймауты, ретраи, разбор ошибок */
export class PayHubHttp {
  constructor(private readonly cfg: PayHubHttpConfig) {}

  /** Запрос к внешнему API PayHub (JSON) */
  async request<T>(method: string, path: string, options: PayHubRequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const timeoutMs = options.timeoutMs ?? this.cfg.timeoutMs;
    const retries = options.retries ?? MAX_RETRIES;
    /** 5xx и сетевые ошибки безопасно повторять только для идемпотентных GET */
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
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // Сетевая ошибка или таймаут
        lastError = error;
        if (retryOnServerError && attempt < retries) {
          this.cfg.logger.warn(
            { method, path, attempt: attempt + 1 },
            'PayHub: сетевая ошибка, повтор запроса',
          );
          await sleep(backoffMs(attempt, null));
          continue;
        }
        this.cfg.logger.error({ method, path }, 'PayHub: сетевая ошибка/таймаут');
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
          'PayHub: повтор запроса после ошибки',
        );
        await sleep(backoffMs(attempt, response.headers.get('retry-after')));
        continue;
      }

      const { code, message } = await parseErrorBody(response);
      this.cfg.logger.error({ method, path, status: response.status, code }, 'PayHub: ошибка API');
      throw new PayHubApiError(response.status, toPayHubErrorCode(code), message);
    }

    // Сюда попадаем только после исчерпания ретраев по сетевой ошибке
    throw lastError instanceof Error ? lastError : new Error('PayHub: запрос не выполнен');
  }

  /**
   * PUT байтов по presigned URL напрямую в S3 PayHub.
   * Без Bearer (URL уже подписан), без ретраев (при ошибке нужен новый presign).
   */
  async putBinary(
    url: string,
    headers: Record<string, string>,
    body: Buffer | Uint8Array,
    timeoutMs: number,
  ): Promise<void> {
    const response = await this.cfg.fetchImpl(url, {
      method: 'PUT',
      headers,
      body: body as unknown as BodyInit,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      this.cfg.logger.error({ status: response.status }, 'PayHub: ошибка загрузки в S3');
      throw new Error(`PayHub: загрузка файла в S3 не удалась (HTTP ${response.status})`);
    }
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(`${this.cfg.baseUrl}${PAYHUB_API_PREFIX}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}
