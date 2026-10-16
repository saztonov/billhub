/**
 * Ошибки интеграции с SIGNAL DOCS (api.sgnl.pro).
 *
 * Как и PayHubApiError, НЕ наследуются от доменных ошибок репозиториев: центральный
 * error handler не должен маскировать ошибку внешней системы под доменную.
 */

/** HTTP-ошибка публичного API SIGNAL */
export class SgnlApiError extends Error {
  /** HTTP-статус ответа SIGNAL (450 — исчерпана квота, 550 — сервис временно недоступен) */
  readonly status: number;
  /** Метод и путь запроса — для диагностики (без query и секретов) */
  readonly endpoint: string;

  constructor(status: number, endpoint: string, message: string) {
    super(message);
    this.name = 'SgnlApiError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

/**
 * Ошибка получения токена (неверные clientId/secret, не выданы scopes, нет лицензии).
 * Фатальна для всего прогона: продолжать по остальным файлам бессмысленно.
 */
export class SgnlAuthError extends Error {
  /** Код из ответа SIGNAL: CredentialError | ScopeError | LicenseError | UnknownError */
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SgnlAuthError';
    this.status = status;
    this.code = code;
  }
}

/** Интеграция SIGNAL не настроена (env-переменные не заданы) */
export class SgnlNotConfiguredError extends Error {
  constructor() {
    super('Интеграция SIGNAL не настроена: задайте SGNL_CLIENT_ID и SGNL_CLIENT_SECRET');
    this.name = 'SgnlNotConfiguredError';
  }
}

/** Фатальная для прогона ошибка: авторизация или исчерпанная квота SIGNAL */
export function isFatalSgnlError(error: unknown): boolean {
  if (error instanceof SgnlAuthError) return true;
  return error instanceof SgnlApiError && (error.status === 401 || error.status === 450);
}

/** Короткое текстовое описание ошибки для журнала/UI */
export function describeSgnlError(error: unknown): string {
  if (error instanceof SgnlAuthError) return `SIGNAL авторизация (${error.code}): ${error.message}`;
  if (error instanceof SgnlApiError) {
    return `SIGNAL HTTP ${error.status} ${error.endpoint}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
