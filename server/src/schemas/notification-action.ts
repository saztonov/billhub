/**
 * zod-схемы тел запросов для notification-actions (создание уведомлений по бизнес-событиям).
 * actorUserId передаётся в теле (исторически), как и в исходных роутах.
 */
import { z } from 'zod';

const departmentValue = z.enum(['omts', 'shtab', 'smetny']);

/* ----------------------------- Заявки на оплату ----------------------------- */

export const paymentStatusChangedBodySchema = z.object({
  paymentRequestId: z.string(),
  statusLabel: z.string(),
  actorUserId: z.string(),
});
export type PaymentStatusChangedBody = z.infer<typeof paymentStatusChangedBodySchema>;

export const paymentRevisionBodySchema = z.object({
  paymentRequestId: z.string(),
  actorUserId: z.string(),
});
export type PaymentRevisionBody = z.infer<typeof paymentRevisionBodySchema>;

export const paymentNewPendingBodySchema = z.object({
  paymentRequestId: z.string(),
  siteId: z.string(),
  actorUserId: z.string(),
  requestNumber: z.string().optional(),
});
export type PaymentNewPendingBody = z.infer<typeof paymentNewPendingBodySchema>;

export const paymentResubmittedBodySchema = z.object({
  paymentRequestId: z.string(),
  actorUserId: z.string(),
  rejectedStage: z.number().nullable(),
});
export type PaymentResubmittedBody = z.infer<typeof paymentResubmittedBodySchema>;

export const omtsRpPendingBodySchema = z.object({
  paymentRequestId: z.string(),
  actorUserId: z.string(),
});
export type OmtsRpPendingBody = z.infer<typeof omtsRpPendingBodySchema>;

export const paymentAssignedBodySchema = z.object({
  paymentRequestId: z.string(),
  assignedUserId: z.string(),
  actorUserId: z.string(),
});
export type PaymentAssignedBody = z.infer<typeof paymentAssignedBodySchema>;

export const paymentNewCommentBodySchema = z.object({
  paymentRequestId: z.string(),
  actorUserId: z.string(),
  recipient: z.string().nullable().optional(),
});
export type PaymentNewCommentBody = z.infer<typeof paymentNewCommentBodySchema>;

export const paymentNewFileBodySchema = z.object({
  paymentRequestId: z.string(),
  actorUserId: z.string(),
});
export type PaymentNewFileBody = z.infer<typeof paymentNewFileBodySchema>;

export const checkSpecialistsBodySchema = z.object({
  paymentRequestId: z.string(),
  siteId: z.string(),
  department: departmentValue,
});
export type CheckSpecialistsBody = z.infer<typeof checkSpecialistsBodySchema>;

/* ----------------------------- Заявки на договор ----------------------------- */

export const contractNewRequestBodySchema = z.object({
  contractRequestId: z.string(),
  siteId: z.string(),
  actorUserId: z.string(),
  requestNumber: z.string().optional(),
});
export type ContractNewRequestBody = z.infer<typeof contractNewRequestBodySchema>;

export const contractStatusChangedBodySchema = z.object({
  contractRequestId: z.string(),
  statusLabel: z.string(),
  actorUserId: z.string(),
});
export type ContractStatusChangedBody = z.infer<typeof contractStatusChangedBodySchema>;

export const contractRevisionBodySchema = z.object({
  contractRequestId: z.string(),
  targets: z.array(z.enum(['shtab', 'counterparty'])),
  actorUserId: z.string(),
});
export type ContractRevisionBody = z.infer<typeof contractRevisionBodySchema>;

export const contractNewCommentBodySchema = z.object({
  contractRequestId: z.string(),
  actorUserId: z.string(),
  recipient: z.string().nullable().optional(),
});
export type ContractNewCommentBody = z.infer<typeof contractNewCommentBodySchema>;

export const contractNewFileBodySchema = z.object({
  contractRequestId: z.string(),
  actorUserId: z.string(),
});
export type ContractNewFileBody = z.infer<typeof contractNewFileBodySchema>;
