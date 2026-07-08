/**
 * zod-схемы тел запросов для согласований (approvals + approval-extra).
 * Имена с префиксом approval*, чтобы не конфликтовать в barrel schemas/index.ts
 * (например, sendToRevisionBodySchema уже занят contract-request).
 */
import { z } from 'zod';

/** Решение по согласованию: /decide и /create-decision (одинаковое тело).
 *  department — легаси-поле: этап определяется current_stage заявки на сервере. */
export const approvalDecideBodySchema = z.object({
  paymentRequestId: z.string(),
  department: z.string().optional(),
  action: z.enum(['approve', 'reject']),
  comment: z.string().optional(),
});
export type ApprovalDecideBody = z.infer<typeof approvalDecideBodySchema>;

/** Отправка на доработку: /send-to-revision (id в теле). */
export const approvalSendToRevisionBodySchema = z.object({
  paymentRequestId: z.string(),
  comment: z.string().optional(),
});
export type ApprovalSendToRevisionBody = z.infer<typeof approvalSendToRevisionBodySchema>;

/** Альтернативный путь доработки: /payment-request/:id/revision (только comment). */
export const approvalRevisionBodySchema = z.object({
  comment: z.string().optional(),
});
export type ApprovalRevisionBody = z.infer<typeof approvalRevisionBodySchema>;

/** Поля, обновляемые при завершении доработки. */
export const approvalFieldUpdatesSchema = z.object({
  deliveryDays: z.number(),
  deliveryDaysType: z.string(),
  shippingConditionId: z.string(),
  invoiceAmount: z.number(),
  supplierId: z.string().nullable().optional(),
});
export type ApprovalFieldUpdates = z.infer<typeof approvalFieldUpdatesSchema>;

/** Завершение доработки: /complete-revision (id + fieldUpdates в теле). */
export const approvalCompleteRevisionBodySchema = z.object({
  paymentRequestId: z.string(),
  fieldUpdates: approvalFieldUpdatesSchema,
});
export type ApprovalCompleteRevisionBody = z.infer<typeof approvalCompleteRevisionBodySchema>;

/** Файл решения: /decision-files (approvalDecisionId + createdBy в теле). */
export const approvalDecisionFileBodySchema = z.object({
  approvalDecisionId: z.string(),
  fileName: z.string(),
  fileKey: z.string(),
  fileSize: z.number().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  createdBy: z.string(),
});
export type ApprovalDecisionFileBody = z.infer<typeof approvalDecisionFileBodySchema>;

/** Файл решения по пути: /decisions/:decisionId/files (decisionId из URL, userId в теле). */
export const approvalDecisionFileByPathBodySchema = z.object({
  fileName: z.string(),
  fileKey: z.string(),
  fileSize: z.number().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  userId: z.string(),
});
export type ApprovalDecisionFileByPathBody = z.infer<typeof approvalDecisionFileByPathBodySchema>;
