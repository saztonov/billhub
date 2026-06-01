/**
 * DrizzleAuditLogRepository (Iteration 7). Запись в партиционированный audit_log (раздел 22).
 * Партиция выбирается PG по created_at (DEFAULT now()). Обслуживание партиций (create-ahead/DROP)
 * — в RetentionService (PG-специфичный DDL). Требует живой PostgreSQL (testcontainers).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { auditLog } from '../../db/schema/index.js';
import type { AuditLogRepository } from '../audit-log.repository.js';
import type { AuditLogEntryInput } from '../../schemas/observability.js';

type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: Db) {}

  async append(entry: AuditLogEntryInput): Promise<void> {
    await this.db.insert(auditLog).values({
      actorUserId: entry.actorUserId ?? null,
      actorEmailHmac: entry.actorEmailHmac ?? null,
      eventType: entry.eventType,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      payload: entry.payload ?? {},
    });
  }
}
