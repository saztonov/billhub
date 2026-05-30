/**
 * Drizzle-схема домена «invoices-ocr». Сгенерирована из sql/schema/schema.json (Iteration 4),
 * далее ведётся через `drizzle-kit introspect:pg` (ADR-0002).
 */
import {
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  counterpartyId: uuid('counterparty_id').notNull(),
  number: text('number').notNull().default(''),
  date: date('date', { mode: 'string' }),
  totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  status: text('status').notNull().default('new'),
  fileKey: text('file_key').notNull().default(''),
  fileName: text('file_name').notNull().default(''),
  ocrResult: text('ocr_result'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  isMarkedForDeletion: boolean('is_marked_for_deletion').notNull().default(false),
  markedForDeletionAt: timestamp('marked_for_deletion_at', { withTimezone: true, mode: 'string' }),
});

export const specifications = pgTable('specifications', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull(),
  position: integer('position').notNull().default(1),
  name: text('name').notNull().default(''),
  unit: text('unit').notNull().default(''),
  quantity: numeric('quantity', { precision: 15, scale: 4 }).notNull().default('0'),
  price: numeric('price', { precision: 15, scale: 2 }).notNull().default('0'),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const ocrModels = pgTable('ocr_models', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  name: text('name').notNull(),
  modelId: text('model_id').notNull(),
  isActive: boolean('is_active').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const ocrRecognitionLog = pgTable('ocr_recognition_log', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  paymentRequestId: uuid('payment_request_id').notNull(),
  fileId: uuid('file_id'),
  modelId: text('model_id').notNull(),
  status: text('status').notNull().default('pending'),
  errorMessage: text('error_message'),
  attemptNumber: integer('attempt_number').notNull().default(1),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalCost: numeric('total_cost', { precision: 15, scale: 6 }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
});

export const recognizedMaterials = pgTable('recognized_materials', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  paymentRequestId: uuid('payment_request_id').notNull(),
  fileId: uuid('file_id'),
  materialId: uuid('material_id').notNull(),
  pageNumber: integer('page_number'),
  position: integer('position').notNull(),
  article: text('article'),
  quantity: numeric('quantity', { precision: 15, scale: 4 }),
  price: numeric('price', { precision: 15, scale: 2 }),
  amount: numeric('amount', { precision: 15, scale: 2 }),
  estimateQuantity: numeric('estimate_quantity', { precision: 15, scale: 4 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const uploadTasks = pgTable('upload_tasks', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  type: text('type').notNull(),
  entityId: uuid('entity_id').notNull(),
  status: text('status').notNull().default('pending'),
  totalFiles: integer('total_files').notNull().default(0),
  uploadedFiles: integer('uploaded_files').notNull().default(0),
  errorMessage: text('error_message'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
