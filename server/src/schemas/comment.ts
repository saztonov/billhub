/**
 * zod-схемы для комментариев к заявкам (оплата/договор).
 */
import { z } from 'zod';
import { uuidSchema, nonEmptyString } from './common.js';

/** DTO комментария (response, плоская структура с данными автора) */
export const commentSchema = z.object({
  id: z.string(),
  paymentRequestId: z.string().optional(),
  contractRequestId: z.string().optional(),
  authorId: z.string(),
  text: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  recipient: z.string().nullable(),
  authorFullName: z.string().nullable(),
  authorEmail: z.string().nullable(),
  authorRole: z.string().nullable(),
  authorDepartment: z.string().nullable(),
  authorCounterpartyName: z.string().nullable(),
});
export type CommentDto = z.infer<typeof commentSchema>;

/** Создание комментария к заявке на оплату */
export const createPaymentCommentBodySchema = z.object({
  paymentRequestId: uuidSchema,
  text: nonEmptyString,
  recipient: z.string().nullable().optional(),
});
export type CreatePaymentCommentBody = z.infer<typeof createPaymentCommentBodySchema>;

/** Создание комментария к заявке на договор */
export const createContractCommentBodySchema = z.object({
  contractRequestId: uuidSchema,
  text: nonEmptyString,
  recipient: z.string().nullable().optional(),
});
export type CreateContractCommentBody = z.infer<typeof createContractCommentBodySchema>;

/** Редактирование текста комментария */
export const updateCommentBodySchema = z.object({
  text: nonEmptyString,
});
export type UpdateCommentBody = z.infer<typeof updateCommentBodySchema>;
