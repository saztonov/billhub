/**
 * Drizzle-схема домена «payment-requests». Сгенерирована из sql/schema/schema.json (Iteration 4),
 * далее ведётся через `drizzle-kit introspect:pg` (ADR-0002).
 */
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const paymentRequests = pgTable('payment_requests', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  requestNumber: varchar('request_number', { length: 20 }).notNull(),
  counterpartyId: uuid('counterparty_id').notNull(),
  statusId: uuid('status_id').notNull(),
  // nullable с 0012: новые типы заявок (contractor_work/own_purchase) не заполняют срок/условия
  deliveryDays: integer('delivery_days'),
  shippingConditionId: uuid('shipping_condition_id'),
  comment: text('comment'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true, mode: 'string' }),
  siteId: uuid('site_id').notNull(),
  totalFiles: integer('total_files').notNull().default(0),
  uploadedFiles: integer('uploaded_files').notNull().default(0),
  currentStage: integer('current_stage'),
  approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'string' }),
  rejectedAt: timestamp('rejected_at', { withTimezone: true, mode: 'string' }),
  withdrawalComment: text('withdrawal_comment'),
  deliveryDaysType: text('delivery_days_type').notNull().default('working'),
  resubmitComment: text('resubmit_comment'),
  resubmitCount: integer('resubmit_count').default(0),
  rejectedStage: integer('rejected_stage'),
  invoiceAmount: numeric('invoice_amount', { precision: 15, scale: 2, mode: 'number' }),
  invoiceAmountHistory: jsonb('invoice_amount_history').default([]),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  paidStatusId: uuid('paid_status_id'),
  totalPaid: numeric('total_paid', { precision: 15, scale: 2, mode: 'number' })
    .notNull()
    .default(0),
  supplierId: uuid('supplier_id'),
  dpNumber: text('dp_number'),
  dpDate: date('dp_date', { mode: 'string' }),
  dpAmount: numeric('dp_amount', { precision: 15, scale: 2, mode: 'number' }),
  dpFileKey: text('dp_file_key'),
  dpFileName: text('dp_file_name'),
  omtsEnteredAt: timestamp('omts_entered_at', { withTimezone: true, mode: 'string' }),
  omtsApprovedAt: timestamp('omts_approved_at', { withTimezone: true, mode: 'string' }),
  previousStatusId: uuid('previous_status_id'),
  stageHistory: jsonb('stage_history').default([]),
  costTypeId: uuid('cost_type_id'),
  materialsVerification: jsonb('materials_verification'),
  closedAt: timestamp('closed_at', { withTimezone: true, mode: 'string' }),
  // Тип заявки (0012): contractor | contractor_work | own_purchase
  requestType: text('request_type').notNull().default('contractor'),
  // Интеграция EstiMat (0019): связь с внешней заявкой + монотонная версия исходящих событий.
  sourceSystem: text('source_system'),
  externalRef: text('external_ref'),
  estimatAggregateVersion: integer('estimat_aggregate_version').notNull().default(0),
});

export const paymentRequestFiles = pgTable('payment_request_files', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  paymentRequestId: uuid('payment_request_id').notNull(),
  documentTypeId: uuid('document_type_id').notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileKey: varchar('file_key', { length: 500 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }),
  mimeType: varchar('mime_type', { length: 100 }),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  pageCount: integer('page_count'),
  isResubmit: boolean('is_resubmit').default(false),
  isAdditional: boolean('is_additional').notNull().default(false),
  isRejected: boolean('is_rejected').notNull().default(false),
  rejectedBy: uuid('rejected_by'),
  rejectedAt: timestamp('rejected_at', { withTimezone: true, mode: 'string' }),
});

export const paymentRequestComments = pgTable('payment_request_comments', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  paymentRequestId: uuid('payment_request_id').notNull(),
  authorId: uuid('author_id').notNull(),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  recipient: text('recipient'),
});

export const paymentRequestAssignments = pgTable('payment_request_assignments', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  paymentRequestId: uuid('payment_request_id').notNull(),
  assignedUserId: uuid('assigned_user_id').notNull(),
  assignedByUserId: uuid('assigned_by_user_id').notNull(),
  assignedAt: timestamp('assigned_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  isCurrent: boolean('is_current').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const paymentRequestLogs = pgTable('payment_request_logs', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  paymentRequestId: uuid('payment_request_id').notNull(),
  userId: uuid('user_id').notNull(),
  action: text('action').notNull(),
  details: jsonb('details'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const paymentRequestFieldOptions = pgTable('payment_request_field_options', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  fieldCode: varchar('field_code', { length: 50 }).notNull(),
  value: varchar('value', { length: 100 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const commentReadStatus = pgTable('comment_read_status', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('user_id').notNull(),
  paymentRequestId: uuid('payment_request_id').notNull(),
  lastReadAt: timestamp('last_read_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});
