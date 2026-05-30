/**
 * Drizzle-схема домена «approvals». Сгенерирована из sql/schema/schema.json (Iteration 4),
 * далее ведётся через `drizzle-kit introspect:pg` (ADR-0002).
 */
import {
  bigint,
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { departmentEnum } from './enums.js';

export const approvalDecisions = pgTable('approval_decisions', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  paymentRequestId: uuid('payment_request_id').notNull(),
  stageOrder: integer('stage_order').notNull(),
  departmentId: departmentEnum('department_id').notNull(),
  status: text('status').notNull().default('pending'),
  userId: uuid('user_id'),
  comment: text('comment').notNull().default(''),
  decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  isOmtsRp: boolean('is_omts_rp').notNull().default(false),
});

export const approvalDecisionFiles = pgTable('approval_decision_files', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  approvalDecisionId: uuid('approval_decision_id').notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileKey: varchar('file_key', { length: 500 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }),
  mimeType: varchar('mime_type', { length: 100 }),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const distributionLetters = pgTable('distribution_letters', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull(),
  counterpartyId: uuid('counterparty_id').notNull(),
  siteId: uuid('site_id').notNull(),
  number: text('number').notNull().default(''),
  date: date('date', { mode: 'string' }),
  totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
