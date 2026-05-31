/**
 * zod-схемы тел запросов для учредительных документов (founding-documents).
 */
import { z } from 'zod';

export const updateFoundingDocBodySchema = z.object({
  isAvailable: z.boolean().optional(),
  comment: z.string().optional(),
});
export type UpdateFoundingDocBody = z.infer<typeof updateFoundingDocBodySchema>;

export const foundingGeneralCommentBodySchema = z.object({
  comment: z.string().nullable(),
});
export type FoundingGeneralCommentBody = z.infer<typeof foundingGeneralCommentBodySchema>;
