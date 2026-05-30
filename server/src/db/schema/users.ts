/**
 * Drizzle-схема домена «users». Сгенерирована из sql/schema/schema.json (Iteration 4),
 * далее ведётся через `drizzle-kit introspect:pg` (ADR-0002).
 */
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { departmentEnum } from './enums.js';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().notNull(),
  email: text('email').notNull(),
  role: text('role').notNull().default('viewer'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  counterpartyId: uuid('counterparty_id'),
  departmentId: departmentEnum('department_id'),
  allSites: boolean('all_sites').notNull().default(false),
  fullName: text('full_name').notNull().default(''),
  isActive: boolean('is_active').notNull().default(true),
});

export const userConstructionSitesMapping = pgTable('user_construction_sites_mapping', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('user_id').notNull(),
  constructionSiteId: uuid('construction_site_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
