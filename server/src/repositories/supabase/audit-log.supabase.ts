/**
 * Supabase-заглушка AuditLogRepository. audit_log — партиционированная таблица c PG-специфичной
 * семантикой (раздел 22); запись ведётся только в Drizzle-режиме. Принцип 2: throw-not-supported.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditLogRepository } from '../audit-log.repository.js';
import type { AuditLogEntryInput } from '../../schemas/observability.js';

const NOT_SUPPORTED = 'AuditLog is Drizzle-only';

export class SupabaseAuditLogRepository implements AuditLogRepository {
  constructor(_supabase: SupabaseClient) {}

  append(_entry: AuditLogEntryInput): Promise<void> {
    throw new Error(NOT_SUPPORTED);
  }
}
