/**
 * zod-схемы для домена «Поставщик» (suppliers).
 */
import { z } from 'zod';
import {
  uuidSchema,
  nonEmptyString,
  innSchema,
  paginationSchema,
  searchSchema,
  paginatedResponseSchema,
} from './common.js';

/** Статус последнего решения СБ по поставщику (миграция 006) */
export const supplierSecurityStatusSchema = z.enum(['approved', 'rejected']);
export type SupplierSecurityStatus = z.infer<typeof supplierSecurityStatusSchema>;

/** Полный DTO поставщика */
export const supplierSchema = z.object({
  id: uuidSchema,
  name: nonEmptyString.max(500),
  inn: innSchema,
  alternativeNames: z.array(z.string()).default([]),
  createdAt: z.iso.datetime({ offset: true }),
  /** Общий комментарий по учредительным документам (миграция 003) */
  foundingDocumentsComment: z.string().nullable().optional(),
  /** Денормализованный last_security_status (миграция 006) */
  lastSecurityStatus: supplierSecurityStatusSchema.nullable().optional(),
  hasPendingRequest: z.boolean().optional(),
});
export type Supplier = z.infer<typeof supplierSchema>;

/** Создание */
export const createSupplierBodySchema = z.object({
  name: nonEmptyString.max(500),
  inn: innSchema,
  alternativeNames: z.array(z.string()).optional(),
});
export type CreateSupplierBody = z.infer<typeof createSupplierBodySchema>;

/** Обновление */
export const updateSupplierBodySchema = z.object({
  name: nonEmptyString.max(500).optional(),
  inn: innSchema.optional(),
  alternativeNames: z.array(z.string()).optional(),
  foundingDocumentsComment: z.string().nullable().optional(),
});
export type UpdateSupplierBody = z.infer<typeof updateSupplierBodySchema>;

/** Список с фильтрами (через list_suppliers_with_sb RPC) */
export const listSuppliersQuerySchema = paginationSchema.merge(searchSchema).extend({
  sbFilter: z.enum(['all', 'pending']).default('all'),
  cutoffDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  onlySupplierId: uuidSchema.optional(),
});
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;

export const listSuppliersResponseSchema = paginatedResponseSchema(supplierSchema);
export type ListSuppliersResponse = z.infer<typeof listSuppliersResponseSchema>;

/* ----------------------- Проверки СБ поставщика (миграция 002/006) ----------------------- */

/** Тип события в истории проверок СБ */
export const supplierSecurityEventTypeSchema = z.enum(['requested', 'approved', 'rejected']);
export type SupplierSecurityEventType = z.infer<typeof supplierSecurityEventTypeSchema>;

/** Событие истории проверок СБ (response) */
export const supplierSecurityCheckSchema = z.object({
  id: uuidSchema,
  supplierId: uuidSchema,
  authorId: uuidSchema,
  authorFullName: z.string(),
  eventType: supplierSecurityEventTypeSchema,
  comment: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type SupplierSecurityCheck = z.infer<typeof supplierSecurityCheckSchema>;

/** Решение СБ (request body) */
export const supplierSecurityDecisionBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().optional(),
});
export type SupplierSecurityDecisionBody = z.infer<typeof supplierSecurityDecisionBodySchema>;

/** Элемент списка поставщиков с агрегатами СБ (response роута GET /suppliers?page=) */
export const supplierListItemSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  inn: z.string(),
  alternativeNames: z.array(z.string()),
  createdAt: z.iso.datetime({ offset: true }),
  lastSecurityCheck: z
    .object({
      status: supplierSecurityStatusSchema,
      createdAt: z.iso.datetime({ offset: true }),
    })
    .nullable(),
  hasPendingRequest: z.boolean(),
});
export type SupplierListItem = z.infer<typeof supplierListItemSchema>;
