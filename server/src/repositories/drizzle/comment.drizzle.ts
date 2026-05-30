/**
 * DrizzleRepository для комментариев (Iteration 5).
 * Автор/контрагент — через leftJoin; отметка прочтения — upsert (onConflictDoUpdate);
 * записи — в db.transaction().
 */
import { desc, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  paymentRequestComments,
  contractRequestComments,
  commentReadStatus,
  contractCommentReadStatus,
  users,
  counterparties,
} from '../../db/schema/index.js';
import type { CommentRepository, UnreadCounts } from '../comment.repository.js';
import type {
  CommentDto,
  CreatePaymentCommentBody,
  CreateContractCommentBody,
} from '../../schemas/comment.js';

type Db = PostgresJsDatabase<typeof schema>;

interface JoinedRow {
  id: string;
  requestId: string;
  authorId: string;
  text: string;
  createdAt: string;
  updatedAt: string | null;
  recipient: string | null;
  authorFullName: string | null;
  authorEmail: string | null;
  authorRole: string | null;
  authorDepartment: string | null;
  authorCounterpartyName: string | null;
}

function toDto(r: JoinedRow, kind: 'payment' | 'contract'): CommentDto {
  const dto: CommentDto = {
    id: r.id,
    authorId: r.authorId,
    text: r.text,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    recipient: r.recipient,
    authorFullName: r.authorFullName,
    authorEmail: r.authorEmail,
    authorRole: r.authorRole,
    authorDepartment: r.authorDepartment,
    authorCounterpartyName: r.authorCounterpartyName,
  };
  if (kind === 'payment') dto.paymentRequestId = r.requestId;
  else dto.contractRequestId = r.requestId;
  return dto;
}

function computeUnread(
  comments: { requestId: string; createdAt: string }[],
  reads: { requestId: string; lastReadAt: string }[],
): UnreadCounts {
  const readMap = new Map(reads.map((r) => [r.requestId, r.lastReadAt]));
  const counts: UnreadCounts = {};
  for (const c of comments) {
    const lastRead = readMap.get(c.requestId);
    if (!lastRead || new Date(c.createdAt) > new Date(lastRead)) {
      counts[c.requestId] = (counts[c.requestId] || 0) + 1;
    }
  }
  return counts;
}

export class DrizzleCommentRepository implements CommentRepository {
  constructor(private readonly db: Db) {}

  /* --------------------------- Комментарии к заявкам на оплату --------------------------- */

  async listPaymentComments(requestId: string): Promise<CommentDto[]> {
    const rows = await this.db
      .select({
        id: paymentRequestComments.id,
        requestId: paymentRequestComments.paymentRequestId,
        authorId: paymentRequestComments.authorId,
        text: paymentRequestComments.text,
        createdAt: paymentRequestComments.createdAt,
        updatedAt: paymentRequestComments.updatedAt,
        recipient: paymentRequestComments.recipient,
        authorFullName: users.fullName,
        authorEmail: users.email,
        authorRole: users.role,
        authorDepartment: users.departmentId,
        authorCounterpartyName: counterparties.name,
      })
      .from(paymentRequestComments)
      .leftJoin(users, eq(users.id, paymentRequestComments.authorId))
      .leftJoin(counterparties, eq(counterparties.id, users.counterpartyId))
      .where(eq(paymentRequestComments.paymentRequestId, requestId))
      .orderBy(desc(paymentRequestComments.createdAt));
    return rows.map((r) => toDto(r, 'payment'));
  }

  async createPaymentComment(authorId: string, body: CreatePaymentCommentBody): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(paymentRequestComments).values({
        paymentRequestId: body.paymentRequestId,
        authorId,
        text: body.text,
        recipient: body.recipient || null,
      });
    });
  }

  async updatePaymentComment(id: string, text: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(paymentRequestComments)
        .set({ text, updatedAt: new Date().toISOString() })
        .where(eq(paymentRequestComments.id, id));
    });
  }

  async deletePaymentComment(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(paymentRequestComments).where(eq(paymentRequestComments.id, id));
    });
  }

  async markReadPayment(userId: string, requestId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await tx
        .insert(commentReadStatus)
        .values({ userId, paymentRequestId: requestId, lastReadAt: now })
        .onConflictDoUpdate({
          target: [commentReadStatus.userId, commentReadStatus.paymentRequestId],
          set: { lastReadAt: now },
        });
    });
  }

  async unreadCountsPayment(userId: string): Promise<UnreadCounts> {
    const comments = await this.db
      .select({
        requestId: paymentRequestComments.paymentRequestId,
        createdAt: paymentRequestComments.createdAt,
      })
      .from(paymentRequestComments)
      .where(ne(paymentRequestComments.authorId, userId));
    const reads = await this.db
      .select({
        requestId: commentReadStatus.paymentRequestId,
        lastReadAt: commentReadStatus.lastReadAt,
      })
      .from(commentReadStatus)
      .where(eq(commentReadStatus.userId, userId));
    return computeUnread(comments, reads);
  }

  /* --------------------------- Комментарии к заявкам на договор --------------------------- */

  async listContractComments(requestId: string): Promise<CommentDto[]> {
    const rows = await this.db
      .select({
        id: contractRequestComments.id,
        requestId: contractRequestComments.contractRequestId,
        authorId: contractRequestComments.authorId,
        text: contractRequestComments.text,
        createdAt: contractRequestComments.createdAt,
        updatedAt: contractRequestComments.updatedAt,
        recipient: contractRequestComments.recipient,
        authorFullName: users.fullName,
        authorEmail: users.email,
        authorRole: users.role,
        authorDepartment: users.departmentId,
        authorCounterpartyName: counterparties.name,
      })
      .from(contractRequestComments)
      .leftJoin(users, eq(users.id, contractRequestComments.authorId))
      .leftJoin(counterparties, eq(counterparties.id, users.counterpartyId))
      .where(eq(contractRequestComments.contractRequestId, requestId))
      .orderBy(desc(contractRequestComments.createdAt));
    return rows.map((r) => toDto(r, 'contract'));
  }

  async createContractComment(authorId: string, body: CreateContractCommentBody): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(contractRequestComments).values({
        contractRequestId: body.contractRequestId,
        authorId,
        text: body.text,
        recipient: body.recipient || null,
      });
    });
  }

  async updateContractComment(id: string, text: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(contractRequestComments)
        .set({ text, updatedAt: new Date().toISOString() })
        .where(eq(contractRequestComments.id, id));
    });
  }

  async deleteContractComment(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(contractRequestComments).where(eq(contractRequestComments.id, id));
    });
  }

  async markReadContract(userId: string, requestId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await tx
        .insert(contractCommentReadStatus)
        .values({ userId, contractRequestId: requestId, lastReadAt: now })
        .onConflictDoUpdate({
          target: [contractCommentReadStatus.userId, contractCommentReadStatus.contractRequestId],
          set: { lastReadAt: now },
        });
    });
  }

  async unreadCountsContract(userId: string): Promise<UnreadCounts> {
    const comments = await this.db
      .select({
        requestId: contractRequestComments.contractRequestId,
        createdAt: contractRequestComments.createdAt,
      })
      .from(contractRequestComments)
      .where(ne(contractRequestComments.authorId, userId));
    const reads = await this.db
      .select({
        requestId: contractCommentReadStatus.contractRequestId,
        lastReadAt: contractCommentReadStatus.lastReadAt,
      })
      .from(contractCommentReadStatus)
      .where(eq(contractCommentReadStatus.userId, userId));
    return computeUnread(comments, reads);
  }
}
