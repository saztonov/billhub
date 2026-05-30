/**
 * Drizzle-схема домена «references». Сгенерирована из sql/schema/schema.json (Iteration 4),
 * далее ведётся через `drizzle-kit introspect:pg` (ADR-0002).
 */
import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const counterparties = pgTable('counterparties', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  name: text('name').notNull(),
  inn: text('inn').notNull().default(''),
  address: text('address').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  alternativeNames: jsonb('alternative_names').$type<string[]>().notNull().default([]),
  registrationToken: uuid('registration_token').defaultRandom(),
});

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  name: text('name').notNull(),
  inn: text('inn').notNull(),
  alternativeNames: jsonb('alternative_names').$type<string[]>().default([]),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  foundingDocumentsComment: text('founding_documents_comment'),
  lastSecurityStatus: text('last_security_status'),
});

export const employees = pgTable('employees', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  fullName: text('full_name').notNull(),
  position: text('position').notNull().default(''),
  department: text('department').notNull().default(''),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  role: text('role').notNull().default('viewer'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const constructionSites = pgTable('construction_sites', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const costTypes = pgTable('cost_types', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const documentTypes = pgTable('document_types', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  category: text('category').notNull().default('operational'),
});

export const materialsDictionary = pgTable('materials_dictionary', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  name: text('name').notNull(),
  unit: text('unit'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
