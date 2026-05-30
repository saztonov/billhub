/**
 * Drizzle-схема домена «contracts». Сгенерирована из sql/schema/schema.json (Iteration 4),
 * далее ведётся через `drizzle-kit introspect:pg` (ADR-0002).
 */
import {
  bigint,
  boolean,
  date,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const contractRequests = pgTable('contract_requests', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  requestNumber: varchar('request_number', { length: 20 }).notNull(),
  siteId: uuid('site_id').notNull(),
  counterpartyId: uuid('counterparty_id').notNull(),
  supplierId: uuid('supplier_id').notNull(),
  partiesCount: smallint('parties_count').notNull(),
  subjectType: varchar('subject_type', { length: 50 }).notNull(),
  subjectDetail: text('subject_detail'),
  statusId: uuid('status_id').notNull(),
  revisionTargets: text('revision_targets').array().notNull().default([]),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  originalReceivedAt: timestamp('original_received_at', { withTimezone: true, mode: 'string' }),
  statusHistory: jsonb('status_history').notNull().default([]),
  responsibleUserId: uuid('responsible_user_id'),
  contractNumber: text('contract_number'),
  contractSigningDate: date('contract_signing_date', { mode: 'string' }),
});

export const contractRequestFiles = pgTable('contract_request_files', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  contractRequestId: uuid('contract_request_id').notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileKey: varchar('file_key', { length: 500 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }),
  mimeType: varchar('mime_type', { length: 100 }),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  isAdditional: boolean('is_additional').notNull().default(false),
  isRejected: boolean('is_rejected').notNull().default(false),
  rejectedBy: uuid('rejected_by'),
  rejectedAt: timestamp('rejected_at', { withTimezone: true, mode: 'string' }),
  isSignedContract: boolean('is_signed_contract').notNull().default(false),
});

export const contractRequestComments = pgTable('contract_request_comments', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  contractRequestId: uuid('contract_request_id').notNull(),
  authorId: uuid('author_id').notNull(),
  text: text('text').notNull(),
  recipient: text('recipient'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
});

export const contractCommentReadStatus = pgTable('contract_comment_read_status', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('user_id').notNull(),
  contractRequestId: uuid('contract_request_id').notNull(),
  lastReadAt: timestamp('last_read_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});
