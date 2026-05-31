/**
 * Audit-логирование security-событий (план Iteration 6: «минимум pino-event с явными полями»;
 * полная таблица audit_log — Iteration 7).
 *
 * ЖЁСТКИЙ ПРИНЦИП: в audit НИКОГДА не попадают секреты — plain-пароли, plain refresh-токены,
 * plain-токены сброса пароля. Для сброса допустим только token_id (не сам токен).
 * Дополнительно к дисциплине вызова — защитная фильтрация запрещённых ключей в sanitizeAuditFields.
 */

export type AuditEvent =
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'token_refresh'
  | 'refresh_reuse'
  | 'password_change'
  | 'password_reset_request'
  | 'password_reset_confirm'
  | 'role_change'
  | 'admin_action'
  | 'user_created'
  | 'user_deactivated';

export interface AuditFields {
  userId?: string;
  /** HMAC email (псевдоним), НЕ сам email. */
  emailHmac?: string;
  ip?: string;
  userAgent?: string;
  /** Для password reset — ТОЛЬКО id токена (никогда сам токен). */
  tokenId?: string;
  familyId?: string;
  targetType?: string;
  targetId?: string;
  reason?: string;
  expiresAt?: string;
  [key: string]: unknown;
}

export interface AuditLogger {
  emit(event: AuditEvent, fields?: AuditFields): void;
}

/**
 * Ключи, которые НИКОГДА не должны попасть в audit (защита от случайной утечки секрета).
 * tokenId / token_id / familyId / emailHmac — разрешены (это не секреты).
 */
const FORBIDDEN_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'token',
  'plain',
  'plaintoken',
  'refreshtoken',
  'refresh_token',
  'accesstoken',
  'access_token',
  'secret',
  'hash',
  'tokenhash',
  'token_hash',
  'passwordhash',
  'password_hash',
]);

/** Удаляет потенциально секретные поля из audit-записи. */
export function sanitizeAuditFields(fields: AuditFields | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields) return out;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

/** Минимальный интерфейс логгера (совместим с pino / fastify.log). */
export interface AuditSink {
  info(obj: Record<string, unknown>, msg?: string): void;
}

/** Пишет audit-события структурированным pino-логом с маркером { audit: true }. */
export function createPinoAuditLogger(sink: AuditSink): AuditLogger {
  return {
    emit(event, fields) {
      sink.info({ audit: true, event, ...sanitizeAuditFields(fields) }, `audit:${event}`);
    },
  };
}

/** Записывает события в массив (для тестов и grep-проверки отсутствия секретов). */
export class RecordingAuditLogger implements AuditLogger {
  readonly events: { event: AuditEvent; fields: Record<string, unknown> }[] = [];

  emit(event: AuditEvent, fields?: AuditFields): void {
    this.events.push({ event, fields: sanitizeAuditFields(fields) });
  }

  /** Сериализованный JSON всех событий (для grep-теста на отсутствие секретов). */
  serialized(): string {
    return JSON.stringify(this.events);
  }
}
