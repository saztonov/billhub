/**
 * Drizzle-схема домена интеграции EstiMat ↔ BillHub (путь 1, заявки на оплату по РП).
 * Источник правды — миграция sql/migrations/0019_estimat_inbound_payment_requests.sql
 * (принцип 6; TS-схема производна). Контракт: EstiMat/integration/estimat-billhub/SKILL.md.
 */
import { bigint, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Сессия импорта заявки на оплату (import-session → confirm files → submit). */
export const externalImportSessions = pgTable('external_import_sessions', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  sourceSystem: text('source_system').notNull().default('estimat'),
  externalRef: text('external_ref').notNull(),
  payloadHash: text('payload_hash').notNull(),
  requestPayload: jsonb('request_payload').notNull(),
  status: text('status').notNull().default('open'),
  paymentRequestId: uuid('payment_request_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'string' }),
});

/** Файл-счёт сессии импорта (staged в S3 BillHub, переносится в payment_request_files на submit). */
export const externalImportFiles = pgTable('external_import_files', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  importSessionId: uuid('import_session_id').notNull(),
  fileKey: text('file_key').notNull(),
  documentTypeId: uuid('document_type_id'),
  fileName: text('file_name').notNull(),
  fileSize: bigint('file_size', { mode: 'number' }),
  mimeType: text('mime_type'),
  checksum: text('checksum'),
  paymentRequestFileId: uuid('payment_request_file_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

/**
 * Исходящая очередь событий BillHub → EstiMat (POST /api/integration/events).
 * Отдельно от audit-outbox (0002). Полный snapshot + монотонная aggregate_version.
 */
export const integrationOutbox = pgTable('integration_outbox', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  eventType: text('event_type').notNull(),
  externalRef: text('external_ref').notNull(),
  eventId: uuid('event_id').notNull().defaultRandom(),
  aggregateVersion: integer('aggregate_version').notNull(),
  payload: jsonb('payload'),
  status: text('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true, mode: 'string' }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  leaseToken: uuid('lease_token'),
  lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'string' }),
  errorCode: text('error_code'),
  lastError: text('last_error'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
