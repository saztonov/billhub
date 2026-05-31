/**
 * zod-схемы тел запросов для оплат (payments).
 */
import { z } from 'zod';

/** POST /api/payments/:paymentRequestId (paymentRequestId из URL) */
export const createPaymentParamBodySchema = z.object({
  paymentDate: z.string(),
  amount: z.number(),
});
export type CreatePaymentParamBody = z.infer<typeof createPaymentParamBodySchema>;

/** POST /api/payments (paymentRequestId в теле) */
export const createPaymentBodySchema = z.object({
  paymentRequestId: z.string(),
  paymentDate: z.string(),
  amount: z.number(),
});
export type CreatePaymentBody = z.infer<typeof createPaymentBodySchema>;

export const updatePaymentBodySchema = z.object({
  paymentDate: z.string().optional(),
  amount: z.number().optional(),
});
export type UpdatePaymentBody = z.infer<typeof updatePaymentBodySchema>;

export const addPaymentFileBodySchema = z.object({
  fileName: z.string(),
  fileKey: z.string(),
  fileSize: z.number().nullable(),
  mimeType: z.string().nullable(),
});
export type AddPaymentFileBody = z.infer<typeof addPaymentFileBodySchema>;
