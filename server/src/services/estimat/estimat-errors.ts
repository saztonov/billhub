/**
 * Ошибки интеграции BillHub → EstiMat (исходящий канал событий /api/integration/events).
 * EstimatApiError НЕ наследуется от доменных ошибок репозиториев — внешнюю интеграцию
 * не маскируем под доменную ошибку.
 */

export type EstimatErrorCode =
  | 'api_key_required'
  | 'api_key_invalid'
  | 'not_found' // 409 «заявка не найдена, повторите позже» (событие раньше ответа submit)
  | 'conflict' // 409 тот же eventId с другим телом
  | 'validation_error'
  | 'unknown';

/** HTTP-ошибка приёмника событий EstiMat. */
export class EstimatApiError extends Error {
  readonly status: number;
  readonly code: EstimatErrorCode;
  /** true — временная (сеть/5xx/429/409-retry): команду стоит повторить позже. */
  readonly retryable: boolean;

  constructor(status: number, code: EstimatErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = 'EstimatApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

/** Интеграция EstiMat (исходящие события) не настроена. */
export class EstimatNotConfiguredError extends Error {
  constructor() {
    super('Интеграция EstiMat не настроена: задайте ESTIMAT_BASE_URL и ESTIMAT_INTEGRATION_TOKEN');
    this.name = 'EstimatNotConfiguredError';
  }
}
