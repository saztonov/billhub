/**
 * zod-схемы тел запросов для заявок на оплату (payment-requests + extra).
 */
import { z } from 'zod';

/** Тип заявки на оплату (0012): обычный подрядчик / работа подрядчика / своя закупка */
export const paymentRequestTypeSchema = z.enum(['contractor', 'contractor_work', 'own_purchase']);
export type PaymentRequestType = z.infer<typeof paymentRequestTypeSchema>;

export const createPaymentRequestBodySchema = z
  .object({
    // Дефолт contractor — совместимо со старым клиентом, не передающим requestType
    requestType: paymentRequestTypeSchema.default('contractor'),
    siteId: z.string(),
    // nullable/optional: заполняются только для типов, где поле видимо (см. superRefine)
    deliveryDays: z.number().int().nullable().optional(),
    deliveryDaysType: z.string().optional(),
    shippingConditionId: z.string().nullable().optional(),
    comment: z.string().nullable().optional(),
    totalFiles: z.number().int(),
    invoiceAmount: z.number().nullable().optional(),
    supplierId: z.string().nullable().optional(),
    counterpartyId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // contractor: срок поставки + условия отгрузки обязательны
    if (data.requestType === 'contractor') {
      if (data.deliveryDays == null) {
        ctx.addIssue({ code: 'custom', path: ['deliveryDays'], message: 'Укажите срок поставки' });
      }
      if (!data.shippingConditionId) {
        ctx.addIssue({
          code: 'custom',
          path: ['shippingConditionId'],
          message: 'Выберите условия отгрузки',
        });
      }
    }
    // own_purchase: условия отгрузки обязательны (срок поставки — нет)
    if (data.requestType === 'own_purchase' && !data.shippingConditionId) {
      ctx.addIssue({
        code: 'custom',
        path: ['shippingConditionId'],
        message: 'Выберите условия отгрузки',
      });
    }
    // contractor_work — ни срок, ни условия не требуются
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
