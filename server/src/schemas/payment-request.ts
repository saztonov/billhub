/**
 * zod-схемы тел запросов для заявок на оплату (payment-requests + extra).
 */
import { z } from 'zod';

export const createPaymentRequestBodySchema = z.object({
  siteId: z.string(),
  deliveryDays: z.number().int(),
  deliveryDaysType: z.string(),
  shippingConditionId: z.string(),
  comment: z.string().nullable().optional(),
  totalFiles: z.number().int(),
  invoiceAmount: z.number().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  counterpartyId: z.string().optional(),
});
export type CreatePaymentRequestBody = z.infer<typeof createPaymentRequestBodySchema>;

export const updatePaymentRequestBodySchema = z.object({
  deliveryDays: z.number().int().optional(),
  deliveryDaysType: z.string().optional(),
  shippingConditionId: z.string().optional(),
  siteId: z.string().optional(),
  comment: z.string().nullable().optional(),
  invoiceAmount: z.number().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  invoiceAmountReason: z.enum(['error', 'amount_change']).optional(),
  newFilesCount: z.number().int().optional(),
});
export type UpdatePaymentRequestBody = z.infer<typeof updatePaymentRequestBodySchema>;

export const withdrawBodySchema = z.object({
  comment: z.string().nullable().optional(),
});
export type WithdrawBody = z.infer<typeof withdrawBodySchema>;

export const resubmitBodySchema = z.object({
  comment: z.string(),
  fileCount: z.number().int().optional(),
  fieldUpdates: z
    .object({
      deliveryDays: z.number().int(),
      deliveryDaysType: z.string(),
      shippingConditionId: z.string(),
      invoiceAmount: z.number(),
    })
    .optional(),
});
export type ResubmitBody = z.infer<typeof resubmitBodySchema>;

export const setStatusBodySchema = z.object({ statusId: z.string() });
export type SetStatusBody = z.infer<typeof setStatusBodySchema>;

export const dpDataBodySchema = z.object({
  dpNumber: z.string(),
  dpDate: z.string(),
  dpAmount: z.number(),
  dpFileKey: z.string(),
  dpFileName: z.string(),
});
export type DpDataBody = z.infer<typeof dpDataBodySchema>;

export const toggleFileRejectionBodySchema = z.object({ fileId: z.string() });
export type ToggleFileRejectionBody = z.infer<typeof toggleFileRejectionBodySchema>;

export const setFileRejectionBodySchema = z.object({
  isRejected: z.boolean(),
  userId: z.string(),
});
export type SetFileRejectionBody = z.infer<typeof setFileRejectionBodySchema>;

export const addPaymentRequestFileBodySchema = z.object({
  documentTypeId: z.string(),
  fileName: z.string(),
  fileKey: z.string(),
  fileSize: z.number(),
  mimeType: z.string().nullable().optional(),
  pageCount: z.number().nullable().optional(),
  userId: z.string(),
  isResubmit: z.boolean().optional(),
  isAdditional: z.boolean().optional(),
});
export type AddPaymentRequestFileBody = z.infer<typeof addPaymentRequestFileBodySchema>;
