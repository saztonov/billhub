/**
 * Низкоуровневый HTTP-транспорт публичного API SIGNAL (api.sgnl.pro).
 *
 * Авторизация: POST /public/v1/auth/token (clientId + clientSecret + scopes) → JWT на 1 час.
 * Токен кэшируется отдельно на каждый набор scopes и обновляется за минуту до истечения;
 * на 401 токен сбрасывается и запрос повторяется один раз.
 *
 * Лимиты SIGNAL: ≤10 rps на clientId, на компанию — пачка 50 и 4 запроса/с. Транспорт
 * выдерживает минимальный интервал между запросами (по умолчанию ~3 rps) и на 429 ждёт
 * Retry-After.
 *
 * Ретраи: 429 — для всех методов (запрос не обработан); 5xx/550 и сетевые ошибки — только
 * если вызывающий явно разрешил (GET и идемпотентные шаги). Создание item не повторяется
 * вслепую: повтор мог бы создать дубль файла.
 *
 * В логи попадают только метод/путь/статус/номер попытки — токен и секрет никогда.
 */
import type { Logger } from 'pino';
import { SgnlApiError, SgnlAuthError } from './sgnl-errors.js';
import type { SgnlAuthToken } from './sgnl-types.js';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;
/** Потолок ожидания из Retry-After (мс) — защита от аномальных значений */
const MAX_RETRY_AFTER_MS = 60_000;
/** Запас до истечения токена, после которого он перевыпускается (мс) */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
/** Минимальный интервал между запросами к API по умолчанию (мс) ≈ 3 rps */
export const DEFAULT_MIN_INTERVAL_MS = 340;

export interface SgnlRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Scopes токена для запроса */
  scopes: readonly string[];
  /** Повторять ли при 5xx/550/сетевой ошибке (по умолчанию — только GET) */
  retryOnServerError?: boolean;
  timeoutMs?: number;
}

export interface SgnlHttpConfig {
  /** Origin API без пути, например https://api.sgnl.pro */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  logger: Logger;
  /** Минимальный интервал между запросами (мс); 0 — без ограничения (тесты) */
  minIntervalMs?: number;
  /** Инжектируемые часы и пауза — для тестов */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

function defaultSleep(ms: number): Promise<void> {
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

/** Извлечение текста ошибки из тела ответа SIGNAL (ApiExceptionModel / ProblemDetails / строка) */
async function parseErrorBody(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`;
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed === 'string') return parsed;
      if (parsed && typeof parsed === 'object') {
        const rec = parsed as Record<string, unknown>;
        for (const key of ['message', 'detail', 'title']) {
          if (typeof rec[key] === 'string' && (rec[key] as string).length > 0) {
            const errors =
              rec.errors && typeof rec.errors === 'object'
                ? ` ${JSON.stringify(rec.errors).slice(0, 300)}`
                : '';
            return `${rec[key] as string}${errors}`;
          }
        }
      }
      return text.slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return fallback;
  }
}

/** Повторяемый ли статус при разрешённых серверных ретраях */
function isServerRetryable(status: number): boolean {
  return status >= 500;
}

export class SgnlHttp {
  private readonly tokens = new Map<string, CachedToken>();
  private readonly pendingTokens = new Map<string, Promise<string>>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private nextSlotAt = 0;

  constructor(private readonly cfg: SgnlHttpConfig) {
    this.now = cfg.now ?? Date.now;
    this.sleep = cfg.sleep ?? defaultSleep;
    this.minIntervalMs = cfg.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  }

  /** Запрос к публичному API (JSON) с авторизацией по токену нужного набора scopes */
  async request<T>(method: string, path: string, options: SgnlRequestOptions): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const endpoint = `${method} ${path}`;
    const retryOnServerError = options.retryOnServerError ?? method === 'GET';
    const timeoutMs = options.timeoutMs ?? this.cfg.timeoutMs;
    let tokenRefreshed = false;

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const token = await this.getToken(options.scopes);
      await this.throttle();
      let response: Response;
      try {
        response = await this.cfg.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
      } catch (error) {
        lastError = error;
        if (retryOnServerError && attempt < MAX_RETRIES) {
          this.cfg.logger.warn(
            { endpoint, attempt: attempt + 1 },
            'SIGNAL: сетевая ошибка, повтор',
          );
          await this.sleep(backoffMs(attempt, null));
          continue;
        }
        this.cfg.logger.error({ endpoint }, 'SIGNAL: сетевая ошибка/таймаут');
        throw error;
      }

      if (response.ok) {
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      // Токен мог быть отозван/истечь раньше срока — перевыпуск и один повтор
      if (response.status === 401 && !tokenRefreshed) {
        tokenRefreshed = true;
        this.tokens.delete(scopeKey(options.scopes));
        attempt--;
        continue;
      }

      const retryable =
        response.status === 429 || (retryOnServerError && isServerRetryable(response.status));
      if (retryable && attempt < MAX_RETRIES) {
        this.cfg.logger.warn(
          { endpoint, status: response.status, attempt: attempt + 1 },
          'SIGNAL: повтор запроса после ошибки',
        );
        await this.sleep(backoffMs(attempt, response.headers.get('retry-after')));
        continue;
      }

      const message = await parseErrorBody(response);
      this.cfg.logger.error({ endpoint, status: response.status }, 'SIGNAL: ошибка API');
      throw new SgnlApiError(response.status, endpoint, message);
    }

    throw lastError instanceof Error ? lastError : new Error(`SIGNAL: ${endpoint} не выполнен`);
  }

  /**
   * PUT байтов по signed URL хранилища SIGNAL. Без Bearer (URL подписан) и без throttle
   * (другой хост). PUT идемпотентен — сетевые ошибки и 5xx повторяются.
   */
  async putSigned(
    url: string,
    body: Buffer,
    contentType: string,
    timeoutMs: number,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.cfg.fetchImpl(url, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: body as unknown as BodyInit,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) return;
        lastError = new SgnlApiError(
          response.status,
          'PUT signed-url',
          await parseErrorBody(response),
        );
        if (response.status < 500) break;
      } catch (error) {
        lastError = error;
      }
      if (attempt < MAX_RETRIES) {
        this.cfg.logger.warn({ attempt: attempt + 1 }, 'SIGNAL: повтор загрузки по signed URL');
        await this.sleep(backoffMs(attempt, null));
      }
    }
    this.cfg.logger.error('SIGNAL: загрузка файла по signed URL не удалась');
    throw lastError instanceof Error ? lastError : new Error('SIGNAL: загрузка файла не удалась');
  }

  /** Токен для набора scopes: из кэша или новый (single-flight на набор) */
  async getToken(scopes: readonly string[]): Promise<string> {
    const key = scopeKey(scopes);
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > this.now()) return cached.token;

    const pending = this.pendingTokens.get(key);
    if (pending) return pending;
    const promise = this.issueToken(scopes)
      .then((issued) => {
        this.tokens.set(key, issued);
        return issued.token;
      })
      .finally(() => this.pendingTokens.delete(key));
    this.pendingTokens.set(key, promise);
    return promise;
  }

  private async issueToken(scopes: readonly string[]): Promise<CachedToken> {
    const endpoint = 'POST /public/v1/auth/token';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.throttle();
      let response: Response;
      try {
        response = await this.cfg.fetchImpl(this.buildUrl('/public/v1/auth/token'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            clientId: this.cfg.clientId,
            clientSecret: this.cfg.clientSecret,
            scopes,
          }),
          signal: AbortSignal.timeout(this.cfg.timeoutMs),
          redirect: 'error',
        });
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          await this.sleep(backoffMs(attempt, null));
          continue;
        }
        this.cfg.logger.error({ endpoint }, 'SIGNAL: сетевая ошибка при получении токена');
        throw error;
      }

      if (response.ok) {
        const data = (await response.json()) as SgnlAuthToken;
        if (!data?.token) throw new SgnlAuthError(response.status, 'UnknownError', 'Пустой токен');
        const ttlMs = (Number(data.expiresIn) > 0 ? Number(data.expiresIn) : 3600) * 1000;
        return { token: data.token, expiresAt: this.now() + ttlMs };
      }

      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        await this.sleep(backoffMs(attempt, response.headers.get('retry-after')));
        continue;
      }

      const message = await parseErrorBody(response);
      this.cfg.logger.error({ endpoint, status: response.status }, 'SIGNAL: токен не выдан');
      // 422 — тело-строка с кодом (ScopeError / CredentialError / LicenseError)
      const code = /^[A-Za-z]+Error$/.test(message) ? message : 'UnknownError';
      throw new SgnlAuthError(response.status, code, authErrorText(code, message));
    }
    throw new SgnlAuthError(0, 'UnknownError', 'SIGNAL: токен не получен');
  }

  /** Выдерживает минимальный интервал между запросами к API */
  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = this.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + this.minIntervalMs;
    if (slot > now) await this.sleep(slot - now);
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const url = new URL(`${this.cfg.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}

function scopeKey(scopes: readonly string[]): string {
  return [...scopes].sort().join(' ');
}

/** Человекочитаемое описание ошибки авторизации SIGNAL */
function authErrorText(code: string, raw: string): string {
  switch (code) {
    case 'ScopeError':
      return 'интеграции не выданы нужные scopes (настройки компании в HUB)';
    case 'CredentialError':
      return 'неверные SGNL_CLIENT_ID / SGNL_CLIENT_SECRET';
    case 'LicenseError':
      return 'нет лицензии на запрошенные scopes';
    default:
      return raw;
  }
}
