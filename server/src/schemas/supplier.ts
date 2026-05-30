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
