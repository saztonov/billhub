/**
 * zod-схемы простых справочников (references):
 * объекты строительства, виды затрат, типы документов, статусы.
 */
import { z } from 'zod';
import { uuidSchema, nonEmptyString } from './common.js';

/* ---------------------------- Объект строительства ---------------------------- */

export const constructionSiteSchema = z.object({
  id: uuidSchema,
  name: nonEmptyString,
  isActive: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ConstructionSite = z.infer<typeof constructionSiteSchema>;

export const createConstructionSiteBodySchema = z.object({
  name: nonEmptyString,
  isActive: z.boolean().optional(),
});
export type CreateConstructionSiteBody = z.infer<typeof createConstructionSiteBodySchema>;

export const updateConstructionSiteBodySchema = z.object({
  name: nonEmptyString.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateConstructionSiteBody = z.infer<typeof updateConstructionSiteBodySchema>;

/* ------------------------------- Вид затрат -------------------------------- */

export const costTypeSchema = z.object({
  id: uuidSchema,
  name: nonEmptyString,
  isActive: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type CostType = z.infer<typeof costTypeSchema>;

export const createCostTypeBodySchema = z.object({
  name: nonEmptyString,
  isActive: z.boolean().optional(),
});
export type CreateCostTypeBody = z.infer<typeof createCostTypeBodySchema>;

export const updateCostTypeBodySchema = z.object({
  name: nonEmptyString.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateCostTypeBody = z.infer<typeof updateCostTypeBodySchema>;

/* ------------------------------ Тип документа ------------------------------ */

export const documentTypeCategorySchema = z.enum(['operational', 'founding']);
export type DocumentTypeCategory = z.infer<typeof documentTypeCategorySchema>;

export const documentTypeSchema = z.object({
  id: uuidSchema,
  name: nonEmptyString,
  category: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const createDocumentTypeBodySchema = z.object({
  name: nonEmptyString,
  category: documentTypeCategorySchema.optional(),
});
export type CreateDocumentTypeBody = z.infer<typeof createDocumentTypeBodySchema>;

export const updateDocumentTypeBodySchema = z.object({
  name: nonEmptyString.optional(),
  category: documentTypeCategorySchema.optional(),
});
export type UpdateDocumentTypeBody = z.infer<typeof updateDocumentTypeBodySchema>;

/* -------------------------------- Статус ----------------------------------- */

export const statusSchema = z.object({
  id: uuidSchema,
  entityType: nonEmptyString,
  code: nonEmptyString,
  name: nonEmptyString,
  color: z.string().nullable(),
  isActive: z.boolean(),
  displayOrder: z.number().int(),
  visibleRoles: z.array(z.string()),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Status = z.infer<typeof statusSchema>;

export const createStatusBodySchema = z.object({
  entityType: nonEmptyString,
  code: nonEmptyString,
  name: nonEmptyString,
  color: z.string().optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
  visibleRoles: z.array(z.string()).optional(),
});
export type CreateStatusBody = z.infer<typeof createStatusBodySchema>;

export const updateStatusBodySchema = z.object({
  code: nonEmptyString.optional(),
  name: nonEmptyString.optional(),
  color: z.string().optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
  visibleRoles: z.array(z.string()).optional(),
});
export type UpdateStatusBody = z.infer<typeof updateStatusBodySchema>;
