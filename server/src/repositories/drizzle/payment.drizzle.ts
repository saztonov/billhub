/**
 * DrizzleRepository для оплат (Iteration 5).
 * recalc total_paid выполняется в JS (Number() per executed row, как в роуте) и пишется как
 * numeric-строка (string-mode) для точной эквивалентности. Все мутации — в db.transaction().
 */
import { and, asc, desc, eq, getTableColumns, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  paymentPayments,
  paymentPaymentFiles,
  paymentRequests,
  statuses,
} from '../../db/schema/index.js';
import type { PaymentRepository, PaymentRow, CreatePaymentInput } from '../payment.repository.js';
import type { UpdatePaymentBody, AddPaymentFileBody } from '../../schemas/payment.js';
import { NotFoundError } from '../types.js';

type Db = PostgresJsDatabase<typeof schema>;
type AnyTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export class DrizzlePaymentRepository implements PaymentRepository {
  constructor(private readonly db: Db) {}

  /** Пересчёт total_paid + paid_status_id (как recalcPaidStatus в роуте), внутри транзакции. */
  private async recalcPaidStatus(
    tx: AnyTx,
    paymentRequestId: string,
  ): Promise<{ totalPaid: number; paidStatusId: string }> {
    const payments = await tx
      .select({ amount: paymentPayments.amount })
      .from(paymentPayments)
      .where(
        and(
          eq(paymentPayments.paymentRequestId, paymentRequestId),
          eq(paymentPayments.isExecuted, true),
        ),
      );
    // Сумма как в роуте: Number() по каждой строке, reduce от 0 (JS float).
    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0);

    const [req] = await tx
      .select({ invoiceAmount: paymentRequests.invoiceAmount })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, paymentRequestId))
      .limit(1);
    if (!req) throw new Error('payment_request не найден');
    const invoiceAmount = Number(req.invoiceAmount) || 0;

    let statusCode = 'not_paid';
    if (totalPaid > 0 && totalPaid < invoiceAmount) statusCode = 'partially_paid';
    else if (totalPaid > 0 && totalPaid >= invoiceAmount) statusCode = 'paid';

    const [st] = await tx
      .select({ id: statuses.id })
      .from(statuses)
      .where(and(eq(statuses.entityType, 'paid'), eq(statuses.code, statusCode)))
      .limit(1);
    if (!st) throw new Error(`Статус paid/${statusCode} не найден`);

    await tx
      .update(paymentRequests)
      .set({ totalPaid, paidStatusId: st.id })
      .where(eq(paymentRequests.id, paymentRequestId));

    return { totalPaid, paidStatusId: st.id };
  }

  private async nextPaymentNumber(tx: AnyTx, paymentRequestId: string): Promise<number> {
    const [row] = await tx
      .select({ paymentNumber: paymentPayments.paymentNumber })
      .from(paymentPayments)
      .where(eq(paymentPayments.paymentRequestId, paymentRequestId))
      .orderBy(desc(paymentPayments.paymentNumber))
      .limit(1);
    return row ? row.paymentNumber + 1 : 1;
  }

  private async paymentRequestIdOf(tx: AnyTx, paymentId: string): Promise<string | null> {
    const [row] = await tx
      .select({ paymentRequestId: paymentPayments.paymentRequestId })
      .from(paymentPayments)
      .where(eq(paymentPayments.id, paymentId))
      .limit(1);
    return row ? row.paymentRequestId : null;
  }

  async listByPaymentRequest(paymentRequestId: string): Promise<PaymentRow[]> {
    const payments = await this.db
      .select(getTableColumns(paymentPayments))
      .from(paymentPayments)
      .where(eq(paymentPayments.paymentRequestId, paymentRequestId))
      .orderBy(asc(paymentPayments.paymentNumber));
    if (payments.length === 0) return [];

    const ids = payments.map((p) => p.id);
    const files = await this.db
      .select(getTableColumns(paymentPaymentFiles))
      .from(paymentPaymentFiles)
      .where(inArray(paymentPaymentFiles.paymentPaymentId, ids));
    const byPayment = new Map<string, Record<string, unknown>[]>();
    for (const f of files) {
      const list = byPayment.get(f.paymentPaymentId) ?? [];
      list.push(f);
      byPayment.set(f.paymentPaymentId, list);
    }
    return payments.map((p) => ({ ...p, files: byPayment.get(p.id) ?? [] }));
  }

  async create(input: CreatePaymentInput): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      const nextNumber = await this.nextPaymentNumber(tx, input.paymentRequestId);
      const [inserted] = await tx
        .insert(paymentPayments)
        .values({
          paymentRequestId: input.paymentRequestId,
          paymentNumber: nextNumber,
          paymentDate: input.paymentDate,
          amount: input.amount,
          createdBy: input.createdBy,
        })
        .returning({ id: paymentPayments.id });
      await this.recalcPaidStatus(tx, input.paymentRequestId);
      return { id: inserted!.id };
    });
  }

  async update(id: string, patch: UpdatePaymentBody, updatedBy: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const updates: Partial<typeof paymentPayments.$inferInsert> = {
        updatedBy,
        updatedAt: new Date().toISOString(),
      };
      if (patch.paymentDate !== undefined) updates.paymentDate = patch.paymentDate;
      if (patch.amount !== undefined) updates.amount = patch.amount;
      await tx.update(paymentPayments).set(updates).where(eq(paymentPayments.id, id));
      const prId = await this.paymentRequestIdOf(tx, id);
      if (prId) await this.recalcPaidStatus(tx, prId);
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const prId = await this.paymentRequestIdOf(tx, id);
      if (prId === null) throw new NotFoundError('Payment', id);
      await tx.delete(paymentPayments).where(eq(paymentPayments.id, id));
      await this.recalcPaidStatus(tx, prId);
    });
  }

  async addFile(paymentId: string, file: AddPaymentFileBody, createdBy: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(paymentPaymentFiles).values({
        paymentPaymentId: paymentId,
        fileName: file.fileName,
        fileKey: file.fileKey,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        createdBy,
      });
      await tx
        .update(paymentPayments)
        .set({ isExecuted: true })
        .where(eq(paymentPayments.id, paymentId));
      const prId = await this.paymentRequestIdOf(tx, paymentId);
      if (prId) await this.recalcPaidStatus(tx, prId);
    });
  }

  async deleteFile(fileId: string, paymentId?: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(paymentPaymentFiles).where(eq(paymentPaymentFiles.id, fileId));
      if (paymentId) {
        const remaining = await tx
          .select({ id: paymentPaymentFiles.id })
          .from(paymentPaymentFiles)
          .where(eq(paymentPaymentFiles.paymentPaymentId, paymentId))
          .limit(1);
        const hasFiles = remaining.length > 0;
        await tx
          .update(paymentPayments)
          .set({ isExecuted: hasFiles })
          .where(eq(paymentPayments.id, paymentId));
        const prId = await this.paymentRequestIdOf(tx, paymentId);
        if (prId) await this.recalcPaidStatus(tx, prId);
      }
    });
  }

  async recalcStatus(
    paymentRequestId: string,
  ): Promise<{ totalPaid: number; paidStatusId: string | null }> {
    return this.db.transaction(async (tx) => {
      await this.recalcPaidStatus(tx, paymentRequestId);
      // Перечитываем СОХРАНЁННОЕ (numeric(15,2)-канонизированное) значение, как в Supabase-impl,
      // иначе вернули бы сырой JS-float (0.1+0.2 → 0.30000000000000004 вместо 0.3).
      const [req] = await tx
        .select({
          totalPaid: paymentRequests.totalPaid,
          paidStatusId: paymentRequests.paidStatusId,
        })
        .from(paymentRequests)
        .where(eq(paymentRequests.id, paymentRequestId))
        .limit(1);
      return {
        totalPaid: Number(req?.totalPaid) || 0,
        paidStatusId: (req?.paidStatusId as string | null) ?? null,
      };
    });
  }
}
