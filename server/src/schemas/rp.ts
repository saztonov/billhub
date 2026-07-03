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

export const createRpBodySchema = z.object({
  supplierId: z.string().uuid(),
  counterpartyId: z.string().uuid(),
  siteId: z.string().uuid(),
  paymentRequestIds: z.array(z.string().uuid()).min(1),
  documents: z.array(rpDocumentRefSchema).default([]),
  letterDate: z.string().nullish(),
});

export const updateRpStatusBodySchema = z.object({
  status: z.string().min(1).max(50),
});

export const rpDocumentsQuerySchema = z.object({
  supplierId: z.string().uuid(),
  counterpartyId: z.string().uuid(),
  siteId: z.string().uuid(),
});
