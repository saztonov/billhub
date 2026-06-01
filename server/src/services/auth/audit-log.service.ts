/**
 * AuditLogService — запись security/admin-событий в таблицу audit_log (стандарт v3 раздел 22,
 * план Iteration 7). Заменяет pino-only логгер Iteration 6: реализует тот же интерфейс
 * AuditLogger.emit(), поэтому auth-сервисы (login/logout/refresh-reuse/password*) не меняются —
 * меняется только реализация, wired в plugins/auth.ts при наличии fastify.db.
 *
 * ЖЁСТКИЙ ПРИНЦИП: секреты в audit_log не попадают. Защита двойная:
 *   1) дисциплина вызова (auth-сервисы передают только token_id/email_hmac/…);
 *   2) sanitizeAuditFields вырезает запрещённые ключи (пароли/токены/хэши) перед записью.
 *
 * actor_email_hmac = HMAC-SHA256(email, AUDIT_HMAC_KEY). На вызовах из auth уже передаётся
 * готовый emailHmac (middleware/rate-limit.emailHmac); logEvent умеет посчитать его и из сырого
 * email (для не-auth вызовов), используя hmacKey из env.
 *
 * emit() — fire-and-forget (auth-роуты не ждут запись в БД): запись в audit_log идёт асинхронно,
 * pino-зеркало — синхронно (наблюдаемость + grep-тест на отсутствие секретов). logEvent() —
 * awaitable (для диспетчера outbox, retention и мониторов, которым нужна гарантия записи).
 */
import { createHmac } from 'node:crypto';
import {
  sanitizeAuditFields,
  type AuditEvent,
  type AuditFields,
  type AuditLogger,
  type AuditSink,
} from './audit.js';
import type { AuditLogRepository } from '../../repositories/audit-log.repository.js';
import type { AuditLogEntryInput } from '../../schemas/observability.js';

/** Поля, уходящие в выделенные колонки audit_log — не дублируются в payload. */
const COLUMN_KEYS = new Set(['userid', 'emailhmac', 'targettype', 'targetid']);

export interface LogEventInput {
  eventType: string;
  actorUserId?: string | null;
  /** Готовый HMAC email (приоритетнее raw email). */
  emailHmac?: string | null;
  /** Сырой email — будет захэширован (HMAC), если emailHmac не задан и есть hmacKey. */
  email?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown>;
}

export interface AuditLogServiceOptions {
  repo: AuditLogRepository;
  /** pino-зеркало (наблюдаемость). Обычно fastify.log. */
  sink?: AuditSink;
  /** Ключ HMAC для logEvent с сырым email (config.auditHmacKey). */
  hmacKey?: string;
  /** Обработчик ошибки фоновой записи (emit fire-and-forget). */
  onError?: (err: unknown) => void;
}

interface Prepared {
  entry: AuditLogEntryInput;
  /** Объект для pino-зеркала (все санитизированные поля + маркеры). */
  mirror: Record<string, unknown>;
}

export class AuditLogService implements AuditLogger {
  constructor(private readonly opts: AuditLogServiceOptions) {}

  private hmac(email: string): string | undefined {
    if (!this.opts.hmacKey) return undefined;
    return createHmac('sha256', this.opts.hmacKey).update(email.trim().toLowerCase()).digest('hex');
  }

  /** Готовит DB-строку + pino-зеркало из LogEventInput (с санитизацией payload). */
  private prepare(input: LogEventInput): Prepared {
    const emailHmac = input.emailHmac ?? (input.email ? (this.hmac(input.email) ?? null) : null);
    const safePayload = sanitizeAuditFields(input.payload as AuditFields | undefined);
    const entry: AuditLogEntryInput = {
      eventType: input.eventType,
      actorUserId: input.actorUserId ?? null,
      actorEmailHmac: emailHmac,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      payload: safePayload,
    };
    const mirror: Record<string, unknown> = { audit: true, event: input.eventType, ...safePayload };
    if (input.actorUserId) mirror.userId = input.actorUserId;
    if (emailHmac) mirror.emailHmac = emailHmac;
    if (input.targetType) mirror.targetType = input.targetType;
    if (input.targetId) mirror.targetId = input.targetId;
    return { entry, mirror };
  }

  /** Преобразует AuditFields (интерфейс Iteration 6) в LogEventInput. */
  private fromFields(event: AuditEvent | string, fields?: AuditFields): LogEventInput {
    const safe = sanitizeAuditFields(fields);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(safe)) {
      if (!COLUMN_KEYS.has(k.toLowerCase())) payload[k] = v;
    }
    return {
      eventType: event,
      actorUserId: (fields?.userId as string | undefined) ?? null,
      emailHmac: (fields?.emailHmac as string | undefined) ?? null,
      targetType: (fields?.targetType as string | undefined) ?? null,
      targetId: (fields?.targetId as string | undefined) ?? null,
      payload,
    };
  }

  /** Awaitable-запись (диспетчер outbox / retention / мониторы). pino + БД. */
  async logEvent(input: LogEventInput): Promise<void> {
    const { entry, mirror } = this.prepare(input);
    this.opts.sink?.info(mirror, `audit:${input.eventType}`);
    await this.opts.repo.append(entry);
  }

  /** AuditLogger.emit — совместимость с auth-сервисами Iteration 6. pino sync + БД fire-and-forget. */
  emit(event: AuditEvent, fields?: AuditFields): void {
    const { entry, mirror } = this.prepare(this.fromFields(event, fields));
    this.opts.sink?.info(mirror, `audit:${event}`);
    void this.opts.repo.append(entry).catch((err) => {
      if (this.opts.onError) this.opts.onError(err);
      else this.opts.sink?.info({ audit: true, event: 'audit_write_error' }, 'audit:write_error');
    });
  }
}
