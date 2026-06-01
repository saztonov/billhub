/**
 * Repository-интерфейс домена «audit_log» (журнал security/admin-событий, стандарт v3 раздел 22).
 *
 * ЖЁСТКИЙ ПРИНЦИП: в audit_log НИКОГДА не пишутся секреты (токены, пароли, plain reset-токены,
 * presigned-URL, OCR-фрагменты с ПДн). Санитизация — на уровне AuditLogService.
 *
 * Партиционирование/retention (PARTITION BY RANGE по месяцам) — PG-специфика; методы
 * обслуживания партиций объявлены только на Drizzle-реализации. Supabase-impl кидает
 * not-supported (принцип 2: AuditLog is Drizzle-only).
 */
import type { AuditLogEntryInput } from '../schemas/observability.js';

export interface AuditLogRepository {
  /** Добавить запись в audit_log (партиция выбирается PG по created_at). */
  append(entry: AuditLogEntryInput): Promise<void>;
}
