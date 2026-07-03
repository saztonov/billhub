/**
 * Ошибки интеграции с PayHub.
 *
 * PayHubApiError НАМЕРЕННО не наследуется от доменных ошибок репозиториев:
 * центральный error handler в app.ts не должен маскировать ошибку внешней
 * интеграции под доменную (NotFound и т.п.) — вызывающий код сам решает,
 * во что её мапить.
 */

/** Коды ошибок внешнего API PayHub (тело {error:{code,message}}) */
export type PayHubErrorCode =
  | 'external_api_not_configured'
  | 'api_key_required'
  | 'api_key_invalid'
  | 'api_key_expired'
  | 'insufficient_scope'
  | 'not_owner'
  | 'forbidden_project'
  | 'ambiguous_letter_lookup'
  | 'not_found'
  | 'validation_error'
  | 'unknown';

const KNOWN_CODES: ReadonlySet<string> = new Set([
  'external_api_not_configured',
  'api_key_required',
  'api_key_invalid',
  'api_key_expired',
  'insufficient_scope',
  'not_owner',
  'forbidden_project',
  'ambiguous_letter_lookup',
  'not_found',
  'validation_error',
]);

/** Приведение произвольного кода из ответа PayHub к типизированному */
export function toPayHubErrorCode(raw: unknown): PayHubErrorCode {
  return typeof raw === 'string' && KNOWN_CODES.has(raw) ? (raw as PayHubErrorCode) : 'unknown';
}

/** HTTP-ошибка внешнего API PayHub */
export class PayHubApiError extends Error {
  /** HTTP-статус ответа PayHub */
  readonly status: number;
  /** Типизированный код из тела ошибки (unknown — если тело не распарсилось) */
  readonly code: PayHubErrorCode;

  constructor(status: number, code: PayHubErrorCode, message: string) {
    super(message);
    this.name = 'PayHubApiError';
    this.status = status;
    this.code = code;
  }
}

/** Интеграция PayHub не настроена (env-переменные не заданы) */
export class PayHubNotConfiguredError extends Error {
  constructor() {
    super('Интеграция PayHub не настроена: задайте PAYHUB_BASE_URL и PAYHUB_API_TOKEN');
    this.name = 'PayHubNotConfiguredError';
  }
}
