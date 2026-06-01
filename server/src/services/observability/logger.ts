/**
 * Единая конфигурация pino-redaction (план Iteration 7, observability §20).
 *
 * Самостоятельные pino-логгеры воркеров/сервисов (ocr-worker, file-processing-worker,
 * ocr-service, openrouter) ранее создавались БЕЗ redaction — это давало конкретный риск утечки
 * ПДн: openrouter логировал фрагменты ответа модели (поля rawContent/jsonStr), ocr — текст.
 * Здесь redaction задаётся централизованно и применяется и к воркерам (createObservabilityLogger),
 * и к Fastify-логгеру (FASTIFY_REDACT_PATHS в app.ts).
 *
 * Логи продолжают писаться, но чувствительные значения заменяются на [Redacted].
 */
import pino, { type Logger } from 'pino';

/**
 * Чувствительные ключи (секреты + ПДн/OCR). Покрываются на верхнем уровне и на один уровень
 * вложенности (*.key). rawContent/jsonStr — фактические имена полей в openrouter-логах;
 * ocr_response/recognized_text/material_name — канонические из плана §7.
 */
export const SENSITIVE_KEYS: string[] = [
  // auth-секреты
  'password',
  'currentPassword',
  'current_password',
  'newPassword',
  'new_password',
  'token',
  'tokenHash',
  'token_hash',
  'refreshToken',
  'refresh_token',
  'accessToken',
  'access_token',
  'plainToken',
  'plain_token',
  'resetToken',
  'reset_token',
  'secret',
  'passwordHash',
  'password_hash',
  'authorization',
  'cookie',
  // presigned-URL
  'presignedUrl',
  'presigned_url',
  'signedUrl',
  'signed_url',
  // OCR / ПДн (риск из плана §7)
  'ocr_response',
  'ocrResponse',
  'recognized_text',
  'recognizedText',
  'material_name',
  'materialName',
  'rawContent',
  'jsonStr',
  'rawResponse',
  'raw_response',
];

/** Пути redaction для самостоятельных pino-логгеров (плоские объекты + один уровень). */
export const REDACT_PATHS: string[] = [...SENSITIVE_KEYS, ...SENSITIVE_KEYS.map((k) => `*.${k}`)];

/** Пути redaction для Fastify-логгера: заголовки запроса + тело + общий список. */
export const FASTIFY_REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.map((k) => `body.${k}`),
  ...REDACT_PATHS,
];

/**
 * pino-логгер с redaction для воркеров/сервисов вне Fastify.
 * level из LOG_LEVEL (по умолчанию info в production, debug иначе).
 */
export function createObservabilityLogger(name: string): Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
  });
}
