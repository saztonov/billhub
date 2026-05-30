/**
 * Drizzle-схема домена «system». Сгенерирована из sql/schema/schema.json (Iteration 4),
 * далее ведётся через `drizzle-kit introspect:pg` (ADR-0002).
 */
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { departmentEnum } from './enums.js';

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  type: text('type').notNull().default('info'),
  title: text('title').notNull(),
  message: text('message').notNull(),
  userId: uuid('user_id').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  paymentRequestId: uuid('payment_request_id'),
  departmentId: departmentEnum('department_id'),
  siteId: uuid('site_id'),
  resolved: boolean('resolved').notNull().default(false),
  resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  contractRequestId: uuid('contract_request_id'),
  counterpartyId: uuid('counterparty_id'),
  supplierId: uuid('supplier_id'),
});

export const errorLogs = pgTable('error_logs', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  errorType: varchar('error_type', { length: 50 }).notNull(),
  errorMessage: text('error_message').notNull(),
  errorStack: text('error_stack'),
  url: text('url'),
  userId: uuid('user_id'),
  userAgent: text('user_agent'),
  component: varchar('component', { length: 255 }),
  metadata: jsonb('metadata'),
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey().notNull(),
  value: jsonb('value').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const statuses = pgTable('statuses', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  color: varchar('color', { length: 20 }),
  isActive: boolean('is_active').notNull().default(true),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  visibleRoles: text('visible_roles').array().notNull().default([]),
});

export const requestNumberSequence = pgTable('request_number_sequence', {
  year: integer('year').primaryKey().notNull(),
  lastNumber: integer('last_number').notNull().default(0),
});
