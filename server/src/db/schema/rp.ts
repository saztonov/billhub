/**
 * Drizzle-схема домена «rp» (распределительные письма / реестр РП). Введена миграцией 0006.
 * Источник правды — sql/migrations/0006_rp_letters.sql (принцип 6).
 */
import { date, numeric, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const rpLetters = pgTable('rp_letters', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  number: text('number').notNull(),
  letterDate: date('letter_date', { mode: 'string' }),
  supplierId: uuid('supplier_id').notNull(),
  counterpartyId: uuid('counterparty_id').notNull(),
  siteId: uuid('site_id').notNull(),
  totalAmount: numeric('total_amount', { precision: 15, scale: 2, mode: 'number' })
    .notNull()
    .default(0),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('draft'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const rpLetterRequests = pgTable(
  'rp_letter_requests',
  {
    rpLetterId: uuid('rp_letter_id').notNull(),
    paymentRequestId: uuid('payment_request_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.rpLetterId, t.paymentRequestId] })],
);

export const rpLetterDocuments = pgTable('rp_letter_documents', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  rpLetterId: uuid('rp_letter_id').notNull(),
  source: text('source').notNull(),
  fileKey: text('file_key').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type'),
  contractNumber: text('contract_number'),
  contractDate: date('contract_date', { mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
