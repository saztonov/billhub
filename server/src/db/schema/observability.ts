/**
 * Drizzle-схема домена «observability» (миграция 0002, Iteration 7).
 * Источник правды — SQL-миграция sql/migrations/0002_outbox_audit.sql; TS-схема производна
 * (ADR-0002, принцип 6).
 *
 *   outbox    — transactional outbox (раздел 16).
 *   auditLog  — журнал security/admin-событий, PARTITION BY RANGE (created_at) по месяцам
 *               (раздел 22). БЕЗ PRIMARY KEY (append-only): PK партиционированной таблицы обязан
 *               включать ключ партиционирования — это дало бы составной PK, которого в схеме нет.
 *   jobsLog   — отчётность по BullMQ-задачам (раздел 21).
 */
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true, mode: 'string' }),
});

export const auditLog = pgTable('audit_log', {
  // Суррогатный id без PRIMARY KEY (см. комментарий к таблице в миграции 0002).
  id: uuid('id').notNull().defaultRandom(),
  actorUserId: uuid('actor_user_id'),
  actorEmailHmac: text('actor_email_hmac'),
  eventType: text('event_type').notNull(),
  targetType: text('target_type'),
  targetId: uuid('target_id'),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const jobsLog = pgTable('jobs_log', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  queueName: text('queue_name').notNull(),
  jobId: text('job_id').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
