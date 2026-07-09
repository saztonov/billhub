/**
 * Drizzle-схема домена «references». Сгенерирована из sql/schema/schema.json (Iteration 4),
 * далее ведётся через `drizzle-kit introspect:pg` (ADR-0002).
 */
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
  // Сопоставление с PayHub: канонический внешний ID + снимок для отображения
  payhubProjectId: integer('payhub_project_id'),
  payhubProjectCode: text('payhub_project_code'),
  payhubProjectName: text('payhub_project_name'),
  payhubContractorId: text('payhub_contractor_id'),
  payhubContractorName: text('payhub_contractor_name'),
  payhubContractorInn: text('payhub_contractor_inn'),
  // Маппинг объекта EstiMat (projectCode) → объект BillHub (0019).
  estimatProjectCode: text('estimat_project_code'),
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
