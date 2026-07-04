/**
 * Drizzle-схема домена «rp» (распределительные письма / реестр РП). Введена миграцией 0006,
 * дополнена миграцией 0008 (интеграция с письмами PayHub).
 * Источник правды — sql/migrations/0006_rp_letters.sql и 0008_rp_letters_payhub.sql (принцип 6).
 */
import {
  bigint,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** Снимок полей формы письма PayHub (создание может быть отложенным). */
export interface RpLetterPayload {
  subject: string;
  content: string;
  responsiblePersonName: string | null;
}

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
  // Интеграция с письмами PayHub (0008).
  payhubLetterId: text('payhub_letter_id'),
  payhubLetterRegNumber: text('payhub_letter_reg_number'),
  payhubLetterUrl: text('payhub_letter_url'),
  payhubLetterStatus: text('payhub_letter_status'),
  payhubLetterError: text('payhub_letter_error'),
  payhubLetterPayload: jsonb('payhub_letter_payload').$type<RpLetterPayload>(),
  payhubLetterStatusUpdatedAt: timestamp('payhub_letter_status_updated_at', {
    withTimezone: true,
    mode: 'string',
  }),
  payhubLetterSyncAttempts: integer('payhub_letter_sync_attempts').notNull().default(0),
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

/** Файлы формы письма (billhub S3); воркер дозагружает их к письму PayHub (0008). */
export const rpLetterAttachments = pgTable('rp_letter_attachments', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  rpLetterId: uuid('rp_letter_id').notNull(),
  fileKey: text('file_key').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  payhubAttachmentId: text('payhub_attachment_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
