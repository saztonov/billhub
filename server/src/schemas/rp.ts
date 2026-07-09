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
  // null — РП по СМР без поставщика (0018); наследуется rpStage1BodySchema.
  supplierId: z.string().uuid().nullable(),
  counterpartyId: z.string().uuid(),
  siteId: z.string().uuid(),
  paymentRequestIds: z.array(z.string().uuid()).min(1),
  documents: z.array(rpDocumentRefSchema).default([]),
  letterDate: z.string().nullish(),
  letter: rpLetterBlockSchema.optional(),
  // Номер счёта (0011): trim + пустая строка -> null на сервере (см. роут).
  invoiceNumber: z.string().max(100).nullish(),
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
        /** 'rp' — скан чистовика (в поле «РП» заявок); 'other' (по умолчанию) — прочие (0010). */
        fileType: z.enum(['rp', 'other']).default('other'),
      }),
    )
    .min(1)
    .max(20),
});

/** Регистрация служебных файлов РП (загружены чанковым аплоадом в контексте rp_service) (0010). */
export const rpServiceFilesBodySchema = z.object({
  files: z
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

/** Параметры удаления служебного файла РП (0010). */
export const rpServiceFileParamsSchema = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
});

/** Кандидаты-счета для прикрепления к РП: активные счета выбранных заявок (0011). */
export const rpInvoiceCandidatesBodySchema = z.object({
  paymentRequestIds: z.array(z.string().uuid()).min(1).max(100),
});

/** Прикрепить счета заявок к РП как служебные файлы (копирование в S3) (0011). */
export const rpAttachInvoicesBodySchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(50),
});

/** Текстовые поля письма (finalize с текстом и редактирование из реестра). */
export const rpLetterTextSchema = z.object({
  letterDate: z.string().nullish(),
  subject: z.string().min(1).max(500),
  content: z.string().max(4000).default(''),
  responsiblePersonName: z.string().max(200).nullish(),
});

/** 1 этап модалки: создать РП и синхронно письмо PayHub (letter обязателен). */
export const rpStage1BodySchema = createRpBodySchema.extend({
  letter: rpLetterBlockSchema,
});

/** finalize: опциональный актуальный текст письма (PATCH PayHub перед постановкой в очередь). */
export const finalizeLetterBodySchema = z.object({
  letter: rpLetterTextSchema.optional(),
});

/** Редактирование текста письма из реестра. */
export const editLetterTextBodySchema = rpLetterTextSchema;

/** Дата отправки письма из реестра (0013): YYYY-MM-DD или null (очистить). */
export const rpSentDateBodySchema = z.object({
  sentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате YYYY-MM-DD')
    .nullable(),
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
