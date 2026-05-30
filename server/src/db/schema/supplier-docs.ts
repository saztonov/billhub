/**
 * Drizzle-схема домена «supplier-docs». Сгенерирована из sql/schema/schema.json (Iteration 4),
 * далее ведётся через `drizzle-kit introspect:pg` (ADR-0002).
 */
import { bigint, boolean, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const supplierFoundingDocuments = pgTable('supplier_founding_documents', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  supplierId: uuid('supplier_id').notNull(),
  foundingDocumentTypeId: uuid('founding_document_type_id').notNull(),
  isAvailable: boolean('is_available').notNull().default(false),
  checkedBy: uuid('checked_by'),
  checkedAt: timestamp('checked_at', { withTimezone: true, mode: 'string' }),
  comment: text('comment').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const foundingDocumentFiles = pgTable('founding_document_files', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  supplierFoundingDocumentId: uuid('supplier_founding_document_id').notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileKey: varchar('file_key', { length: 500 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }),
  mimeType: varchar('mime_type', { length: 100 }),
  comment: text('comment').notNull().default(''),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
