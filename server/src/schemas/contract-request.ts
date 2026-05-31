/**
 * zod-схемы тел запросов для заявок на договор (contract-requests).
 */
import { z } from 'zod';

export const createContractRequestBodySchema = z.object({
  siteId: z.string(),
  counterpartyId: z.string(),
  supplierId: z.string(),
  partiesCount: z.number().int(),
  subjectType: z.string(),
  subjectDetail: z.string().nullable().optional(),
  totalFiles: z.number().int().optional(),
});
export type CreateContractRequestBody = z.infer<typeof createContractRequestBodySchema>;

export const updateContractRequestBodySchema = z.object({
  siteId: z.string().optional(),
  counterpartyId: z.string().optional(),
  supplierId: z.string().optional(),
  partiesCount: z.number().int().optional(),
  subjectType: z.string().optional(),
  subjectDetail: z.string().nullable().optional(),
});
export type UpdateContractRequestBody = z.infer<typeof updateContractRequestBodySchema>;

export const contractDetailsBodySchema = z.object({
  contractNumber: z.string().nullable().optional(),
  contractSigningDate: z.string().nullable().optional(),
});
export type ContractDetailsBody = z.infer<typeof contractDetailsBodySchema>;

export const sendToRevisionBodySchema = z.object({ targets: z.array(z.string()) });
export type SendToRevisionBody = z.infer<typeof sendToRevisionBodySchema>;

export const contractCompleteRevisionBodySchema = z.object({ target: z.string() });
export type ContractCompleteRevisionBody = z.infer<typeof contractCompleteRevisionBodySchema>;

export const contractCommentReasonBodySchema = z.object({
  comment: z.string().nullable().optional(),
});
export type ContractCommentReasonBody = z.infer<typeof contractCommentReasonBodySchema>;

export const addContractFileBodySchema = z.object({
  fileName: z.string(),
  fileKey: z.string(),
  fileSize: z.number(),
  mimeType: z.string().nullable().optional(),
  userId: z.string(),
  isAdditional: z.boolean().optional(),
  isSignedContract: z.boolean().optional(),
});
export type AddContractFileBody = z.infer<typeof addContractFileBodySchema>;

export const contractFileRejectionBodySchema = z.object({
  isRejected: z.boolean(),
  userId: z.string(),
});
export type ContractFileRejectionBody = z.infer<typeof contractFileRejectionBodySchema>;

export const contractToggleFileRejectionBodySchema = z.object({ fileId: z.string() });
export type ContractToggleFileRejectionBody = z.infer<typeof contractToggleFileRejectionBodySchema>;

export const contractSignedContractBodySchema = z.object({ isSignedContract: z.boolean() });
export type ContractSignedContractBody = z.infer<typeof contractSignedContractBodySchema>;
