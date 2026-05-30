/**
 * CommentRepository — комментарии к заявкам на оплату и на договор.
 * Strangler Fig: реализации — Supabase (rollback) и Drizzle.
 */
import type {
  CommentDto,
  CreatePaymentCommentBody,
  CreateContractCommentBody,
} from '../schemas/comment.js';

/** Карта непрочитанных: requestId -> количество */
export type UnreadCounts = Record<string, number>;

export interface CommentRepository {
  /* --- Комментарии к заявкам на оплату --- */
  listPaymentComments(requestId: string): Promise<CommentDto[]>;
  createPaymentComment(authorId: string, body: CreatePaymentCommentBody): Promise<void>;
  updatePaymentComment(id: string, text: string): Promise<void>;
  deletePaymentComment(id: string): Promise<void>;
  markReadPayment(userId: string, requestId: string): Promise<void>;
  unreadCountsPayment(userId: string): Promise<UnreadCounts>;

  /* --- Комментарии к заявкам на договор --- */
  listContractComments(requestId: string): Promise<CommentDto[]>;
  createContractComment(authorId: string, body: CreateContractCommentBody): Promise<void>;
  updateContractComment(id: string, text: string): Promise<void>;
  deleteContractComment(id: string): Promise<void>;
  markReadContract(userId: string, requestId: string): Promise<void>;
  unreadCountsContract(userId: string): Promise<UnreadCounts>;
}
