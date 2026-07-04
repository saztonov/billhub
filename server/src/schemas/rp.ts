/**
 * Zod-схемы валидации тела запросов реестра РП (/api/rp).
 */
import { z } from 'zod';

export const rpDocumentRefSchema = z.object({
  source: z.enum(['contract', 'founding']),
  fileKey: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().nullish(),
  contractNumber: z.string().nullish(),
  contractDate: z.string().nullish(),
});

/** Блок письма PayHub при создании РП (поля формы, редактируемые пользователем). */
export const rpLetterBlockSchema = z.object({
  subject: z.string().min(1).max(500),
  content: z.string().max(4000).default(''),
  responsiblePersonName: z.string().max(200).nullish(),
  /** true — клиент догрузит файлы и вызовет finalize; false — задача ставится сразу */
  hasAttachments: z.boolean().default(false),
});

export const createRpBodySchema = z.object({
  supplierId: z.string().uuid(),
  counterpartyId: z.string().uuid(),
  siteId: z.string().uuid(),
  paymentRequestIds: z.array(z.string().uuid()).min(1),
  documents: z.array(rpDocumentRefSchema).default([]),
  letterDate: z.string().nullish(),
  letter: rpLetterBlockSchema.optional(),
});

/** Регистрация файлов письма (уже загруженных чанковым аплоадом в контексте rp_letter). */
export const rpLetterAttachmentsBodySchema = z.object({
  attachments: z
    .array(
      z.object({
        fileKey: z.string().min(1).max(1024),
        fileName: z.string().min(1).max(255),
        mimeType: z.string().max(255).nullish(),
        sizeBytes: z.number().int().positive().nullish(),
      }),
    )
    .min(1)
    .max(20),
});

export const rpIdParamsSchema = z.object({ id: z.string().uuid() });

export const updateRpStatusBodySchema = z.object({
  status: z.string().min(1).max(50),
});

export const rpDocumentsQuerySchema = z.object({
  supplierId: z.string().uuid(),
  counterpartyId: z.string().uuid(),
  siteId: z.string().uuid(),
});
