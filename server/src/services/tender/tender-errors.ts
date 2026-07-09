/**
 * Ошибки интеграции с тендерным порталом (BillHub — инициатор). Bearer-авторизация.
 * TenderApiError не наследуется от доменных ошибок репозиториев.
 */

export type TenderErrorCode =
  | 'external_api_not_configured'
  | 'api_key_required'
  | 'api_key_invalid'
  | 'api_key_expired'
  | 'insufficient_scope'
  | 'external_ref_conflict'
  | 'not_found'
  | 'validation_error'
  | 'unknown';

const KNOWN_CODES: ReadonlySet<string> = new Set([
  'external_api_not_configured',
  'api_key_required',
  'api_key_invalid',
  'api_key_expired',
  'insufficient_scope',
  'external_ref_conflict',
  'not_found',
  'validation_error',
]);

export function toTenderErrorCode(raw: unknown): TenderErrorCode {
  return typeof raw === 'string' && KNOWN_CODES.has(raw) ? (raw as TenderErrorCode) : 'unknown';
}

export class TenderApiError extends Error {
  readonly status: number;
  readonly code: TenderErrorCode;

  constructor(status: number, code: TenderErrorCode, message: string) {
    super(message);
    this.name = 'TenderApiError';
    this.status = status;
    this.code = code;
  }
}

export class TenderNotConfiguredError extends Error {
  constructor() {
    super('Интеграция тендерного портала не настроена: задайте TENDER_BASE_URL и TENDER_API_TOKEN');
    this.name = 'TenderNotConfiguredError';
  }
}
