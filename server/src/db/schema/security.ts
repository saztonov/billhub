/**
 * Drizzle-схема домена «security». Сгенерирована из sql/schema/schema.json (Iteration 4),
 * далее ведётся через `drizzle-kit introspect:pg` (ADR-0002).
 */
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const counterpartySecurityChecks = pgTable('counterparty_security_checks', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  counterpartyId: uuid('counterparty_id').notNull(),
  authorId: uuid('author_id').notNull(),
  eventType: text('event_type').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const supplierSecurityChecks = pgTable('supplier_security_checks', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  supplierId: uuid('supplier_id').notNull(),
  authorId: uuid('author_id').notNull(),
  eventType: text('event_type').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
