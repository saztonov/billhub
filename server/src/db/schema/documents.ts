/**
 * Drizzle-схема домена «documents». Сгенерирована из sql/schema/schema.json (Iteration 4),
 * далее ведётся через `drizzle-kit introspect:pg` (ADR-0002).
 */
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  counterpartyId: uuid('counterparty_id').notNull(),
  documentTypeId: uuid('document_type_id').notNull(),
  siteId: uuid('site_id').notNull(),
  fileName: text('file_name').notNull().default(''),
  fileKey: text('file_key').notNull().default(''),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  isMarkedForDeletion: boolean('is_marked_for_deletion').notNull().default(false),
  markedForDeletionAt: timestamp('marked_for_deletion_at', { withTimezone: true, mode: 'string' }),
});

export const siteRequiredDocumentsMapping = pgTable('site_required_documents_mapping', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  siteId: uuid('site_id').notNull(),
  documentTypeId: uuid('document_type_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
