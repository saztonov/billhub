/**
 * Drizzle-схема домена «payments». Сгенерирована из sql/schema/schema.json (Iteration 4),
 * далее ведётся через `drizzle-kit introspect:pg` (ADR-0002).
 */
import {
  bigint,
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const paymentPayments = pgTable('payment_payments', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  paymentRequestId: uuid('payment_request_id').notNull(),
  paymentNumber: integer('payment_number').notNull(),
  paymentDate: date('payment_date', { mode: 'string' }).notNull(),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  createdBy: uuid('created_by').notNull(),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  isExecuted: boolean('is_executed').notNull().default(false),
});

export const paymentPaymentFiles = pgTable('payment_payment_files', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  paymentPaymentId: uuid('payment_payment_id').notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileKey: varchar('file_key', { length: 500 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }),
  mimeType: varchar('mime_type', { length: 100 }),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
