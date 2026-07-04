/**
 * DrizzleRepository для заявок на оплату (Iteration 5).
 * Воспроизводит join-граф и бизнес-логику роутов; записи — в db.transaction().
 *
 * Финальность — по СТАТУСУ (миграция 004): resubmit() очищает withdrawn_at + withdrawal_comment.
 * generate_request_number вызывается ВНУТРИ транзакции create().
 */
import { and, asc, desc, eq, getTableColumns, gte, ilike, inArray, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  paymentRequests,
  paymentRequestFiles,
  paymentRequestLogs,
  approvalDecisions,
  statuses,
  counterparties,
  users,
  documentTypes,
  userConstructionSitesMapping,
  rpLetterRequests,
} from '../../db/schema/index.js';
import { joinedPaymentRequests } from './payment-request-projection.js';
import type {
  PaymentRequestRepository,
  PaymentRequestListFilter,
  PaymentRequestRow,
  CreatePaymentRequestInput,
} from '../payment-request.repository.js';
import type {
  UpdatePaymentRequestBody,
  ResubmitBody,
  DpDataBody,
  AddPaymentRequestFileBody,
} from '../../schemas/payment-request.js';
import { NotFoundError, ForbiddenError } from '../types.js';

type Db = PostgresJsDatabase<typeof schema>;
type AnyTx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function statusIdByCode(tx: Db | AnyTx, entityType: string, code: string): Promise<string> {
  const [row] = await tx
    .select({ id: statuses.id })
    .from(statuses)
    .where(and(eq(statuses.entityType, entityType), eq(statuses.code, code)))
    .limit(1);
  if (!row) throw new Error(`Статус ${entityType}/${code} не найден`);
  return row.id;
}

export class DrizzlePaymentRequestRepository implements PaymentRequestRepository {
  constructor(private readonly db: Db) {}

  /**
   * Проекция списка/детали: все колонки заявки + join-поля (camelCase, как после preSerialization).
   * Вынесена в общий модуль payment-request-projection (единый источник формы строки заявки,
   * переиспользуется DrizzleApprovalRepository).
   */
  private joined() {
    return joinedPaymentRequests(this.db);
  }

  async getUserSiteIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ siteId: userConstructionSitesMapping.constructionSiteId })
      .from(userConstructionSitesMapping)
      .where(eq(userConstructionSitesMapping.userId, userId));
    return rows.map((r) => r.siteId);
  }

  async list(filter: PaymentRequestListFilter): Promise<PaymentRequestRow[]> {
    if (filter.siteIds && filter.siteIds.length === 0) return [];

    const conds = [];
    if (!filter.showDeleted) conds.push(eq(paymentRequests.isDeleted, false));
    if (filter.counterpartyId)
      conds.push(eq(paymentRequests.counterpartyId, filter.counterpartyId));
    if (filter.siteIds && filter.siteIds.length > 0) {
      conds.push(inArray(paymentRequests.siteId, filter.siteIds));
    }
    if (filter.supplierId) conds.push(eq(paymentRequests.supplierId, filter.supplierId));
    if (filter.siteId) conds.push(eq(paymentRequests.siteId, filter.siteId));
    if (filter.statusId) conds.push(eq(paymentRequests.statusId, filter.statusId));
    if (filter.costTypeId) conds.push(eq(paymentRequests.costTypeId, filter.costTypeId));
    if (filter.dateFrom) conds.push(gte(paymentRequests.createdAt, filter.dateFrom));
    if (filter.dateTo) conds.push(lte(paymentRequests.createdAt, filter.dateTo + 'T23:59:59.999Z'));
    if (filter.search) conds.push(ilike(paymentRequests.requestNumber, `%${filter.search}%`));

    let q = this.joined()
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(paymentRequests.createdAt))
      .$dynamic();
    if (filter.pagination) {
      q = q
        .limit(filter.pagination.pageSize)
        .offset((filter.pagination.page - 1) * filter.pagination.pageSize);
    }
    return (await q) as PaymentRequestRow[];
  }

  async getById(id: string): Promise<PaymentRequestRow | null> {
    const [row] = await this.joined().where(eq(paymentRequests.id, id)).limit(1);
    return (row as PaymentRequestRow) ?? null;
  }

  async getOwnerCounterpartyId(id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ counterpartyId: paymentRequests.counterpartyId })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, id))
      .limit(1);
    return row ? row.counterpartyId : null;
  }

  async create(
    input: CreatePaymentRequestInput,
  ): Promise<{ requestId: string; requestNumber: string }> {
    return this.db.transaction(async (tx) => {
      const statusId = await statusIdByCode(tx, 'payment_request', 'approv_shtab');

      const numRows = (await tx.execute(
        sql`select generate_request_number() as num`,
      )) as unknown as { num: string }[];
      const requestNumber = numRows[0]!.num;

      const [created] = await tx
        .insert(paymentRequests)
        .values({
          requestNumber,
          counterpartyId: input.counterpartyId,
          siteId: input.siteId,
          statusId,
          deliveryDays: input.deliveryDays,
          deliveryDaysType: input.deliveryDaysType,
          shippingConditionId: input.shippingConditionId,
          comment: input.comment || null,
          // как в исходном роуте: `invoice_amount: body.invoiceAmount || null` (0 ⇒ null).
          invoiceAmount: input.invoiceAmount || null,
          supplierId: input.supplierId || null,
          totalFiles: input.totalFiles,
          uploadedFiles: 0,
          createdBy: input.createdBy,
        })
        .returning({ id: paymentRequests.id });
      const requestId = created!.id;

      await tx.insert(approvalDecisions).values({
        paymentRequestId: requestId,
        stageOrder: 1,
        departmentId: 'shtab',
        status: 'pending',
      });

      const [pr] = await tx
        .select({ stageHistory: paymentRequests.stageHistory })
        .from(paymentRequests)
        .where(eq(paymentRequests.id, requestId))
        .limit(1);
      const history = ((pr?.stageHistory as Record<string, unknown>[] | null) ?? []).slice();
      history.push({
        stage: 1,
        department: 'shtab',
        event: 'received',
        at: new Date().toISOString(),
      });

      await tx
        .update(paymentRequests)
        .set({ stageHistory: history, currentStage: 1 })
        .where(eq(paymentRequests.id, requestId));

      return { requestId, requestNumber };
    });
  }

  async update(
    id: string,
    patch: UpdatePaymentRequestBody,
    ctx: { userId: string; actingCounterpartyId?: string | null },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [snap] = await tx
        .select({
          deliveryDays: paymentRequests.deliveryDays,
          deliveryDaysType: paymentRequests.deliveryDaysType,
          shippingConditionId: paymentRequests.shippingConditionId,
          siteId: paymentRequests.siteId,
          comment: paymentRequests.comment,
          invoiceAmount: paymentRequests.invoiceAmount,
          invoiceAmountHistory: paymentRequests.invoiceAmountHistory,
          totalFiles: paymentRequests.totalFiles,
          supplierId: paymentRequests.supplierId,
          counterpartyId: paymentRequests.counterpartyId,
        })
        .from(paymentRequests)
        .where(eq(paymentRequests.id, id))
        .limit(1);
      if (!snap) throw new NotFoundError('PaymentRequest', id);
      if (ctx.actingCounterpartyId != null && snap.counterpartyId !== ctx.actingCounterpartyId) {
        throw new ForbiddenError();
      }

      const updates: Partial<typeof paymentRequests.$inferInsert> = {};
      const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];
      const push = (field: string, oldValue: unknown, newValue: unknown) =>
        changes.push({ field, oldValue, newValue });

      if (patch.deliveryDays !== undefined && patch.deliveryDays !== snap.deliveryDays) {
        updates.deliveryDays = patch.deliveryDays;
        push('delivery_days', snap.deliveryDays, patch.deliveryDays);
      }
      if (
        patch.deliveryDaysType !== undefined &&
        patch.deliveryDaysType !== snap.deliveryDaysType
      ) {
        updates.deliveryDaysType = patch.deliveryDaysType;
        push('delivery_days_type', snap.deliveryDaysType, patch.deliveryDaysType);
      }
      if (
        patch.shippingConditionId !== undefined &&
        patch.shippingConditionId !== snap.shippingConditionId
      ) {
        updates.shippingConditionId = patch.shippingConditionId;
        push('shipping_condition_id', snap.shippingConditionId, patch.shippingConditionId);
      }
      if (patch.siteId !== undefined && patch.siteId !== snap.siteId) {
        updates.siteId = patch.siteId;
        push('site_id', snap.siteId, patch.siteId);
      }
      if (patch.comment !== undefined && patch.comment !== snap.comment) {
        updates.comment = patch.comment ?? null;
        push('comment', snap.comment, patch.comment ?? null);
      }
      let invoiceAmountChanged = false;
      if (
        patch.invoiceAmount !== undefined &&
        (patch.invoiceAmount ?? null) !== snap.invoiceAmount
      ) {
        updates.invoiceAmount = patch.invoiceAmount ?? null;
        push('invoice_amount', snap.invoiceAmount, patch.invoiceAmount ?? null);
        invoiceAmountChanged = true;
      }
      if (patch.supplierId !== undefined && patch.supplierId !== snap.supplierId) {
        updates.supplierId = patch.supplierId ?? null;
        push('supplier_id', snap.supplierId, patch.supplierId ?? null);
      }

      if (
        invoiceAmountChanged &&
        patch.invoiceAmountReason === 'amount_change' &&
        snap.invoiceAmount != null
      ) {
        // Архивируем СЫРОЕ строковое значение numeric (как PostgREST), без Number().
        const history = ((snap.invoiceAmountHistory as Record<string, unknown>[]) ?? []).slice();
        history.push({ amount: snap.invoiceAmount, changedAt: new Date().toISOString() });
        updates.invoiceAmountHistory = history;
      }

      if (patch.newFilesCount && patch.newFilesCount > 0) {
        updates.totalFiles = (snap.totalFiles ?? 0) + patch.newFilesCount;
      }

      if (Object.keys(updates).length > 0) {
        await tx.update(paymentRequests).set(updates).where(eq(paymentRequests.id, id));
      }

      if (changes.length > 0) {
        const details: Record<string, unknown> = { changes };
        if (patch.invoiceAmountReason && invoiceAmountChanged) {
          details.invoiceAmountReason = patch.invoiceAmountReason;
        }
        await tx.insert(paymentRequestLogs).values({
          paymentRequestId: id,
          userId: ctx.userId,
          action: 'edit',
          details,
        });
      }
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(paymentRequests)
        .set({ isDeleted: true, deletedAt: new Date().toISOString() })
        .where(eq(paymentRequests.id, id));
    });
  }

  async withdraw(id: string, comment?: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const statusId = await statusIdByCode(tx, 'payment_request', 'withdrawn');
      await tx
        .update(paymentRequests)
        .set({
          statusId,
          withdrawnAt: new Date().toISOString(),
          withdrawalComment: comment || null,
        })
        .where(eq(paymentRequests.id, id));
    });
  }

  async resubmit(id: string, input: ResubmitBody, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const statusId = await statusIdByCode(tx, 'payment_request', 'approv_shtab');

      const [cur] = await tx
        .select({
          resubmitCount: paymentRequests.resubmitCount,
          invoiceAmount: paymentRequests.invoiceAmount,
          invoiceAmountHistory: paymentRequests.invoiceAmountHistory,
        })
        .from(paymentRequests)
        .where(eq(paymentRequests.id, id))
        .limit(1);
      if (!cur) throw new NotFoundError('PaymentRequest', id);

      const newCount = (cur.resubmitCount ?? 0) + 1;
      const updateData: Partial<typeof paymentRequests.$inferInsert> = {
        statusId,
        rejectedAt: null,
        rejectedStage: null,
        approvedAt: null,
        currentStage: 1,
        resubmitComment: input.comment || null,
        resubmitCount: newCount,
        // Реактивация: снимаем флаг отзыва (миграция 004).
        withdrawnAt: null,
        withdrawalComment: null,
      };

      if (input.fieldUpdates) {
        // Архивируем СЫРОЕ строковое значение numeric (как PostgREST: "100.00"), без Number().
        const history = ((cur.invoiceAmountHistory as Record<string, unknown>[]) ?? []).slice();
        if (cur.invoiceAmount != null) {
          history.push({ amount: cur.invoiceAmount, changedAt: new Date().toISOString() });
        }
        updateData.invoiceAmountHistory = history;
        updateData.deliveryDays = input.fieldUpdates.deliveryDays;
        updateData.deliveryDaysType = input.fieldUpdates.deliveryDaysType;
        updateData.shippingConditionId = input.fieldUpdates.shippingConditionId;
        updateData.invoiceAmount = input.fieldUpdates.invoiceAmount ?? null;
      }

      await tx.update(paymentRequests).set(updateData).where(eq(paymentRequests.id, id));

      await tx
        .delete(approvalDecisions)
        .where(
          and(
            eq(approvalDecisions.paymentRequestId, id),
            eq(approvalDecisions.stageOrder, 1),
            eq(approvalDecisions.departmentId, 'shtab'),
            eq(approvalDecisions.status, 'pending'),
          ),
        );

      await tx.insert(approvalDecisions).values({
        paymentRequestId: id,
        stageOrder: 1,
        departmentId: 'shtab',
        status: 'pending',
      });

      const [pr] = await tx
        .select({ stageHistory: paymentRequests.stageHistory })
        .from(paymentRequests)
        .where(eq(paymentRequests.id, id))
        .limit(1);
      const history = ((pr?.stageHistory as Record<string, unknown>[] | null) ?? []).slice();
      history.push({
        stage: 1,
        department: 'shtab',
        event: 'received',
        at: new Date().toISOString(),
      });
      await tx
        .update(paymentRequests)
        .set({ stageHistory: history })
        .where(eq(paymentRequests.id, id));

      await tx.insert(paymentRequestLogs).values({
        paymentRequestId: id,
        userId,
        action: 'resubmit',
        details: {
          comment: input.comment,
          fileCount: input.fileCount ?? 0,
          target_stage: 1,
          target_department: 'shtab',
          resubmit_count: newCount,
        },
      });
    });
  }

  async setStatus(id: string, statusId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(paymentRequests).set({ statusId }).where(eq(paymentRequests.id, id));
    });
  }

  async setDpData(id: string, dp: DpDataBody): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(paymentRequests)
        .set({
          dpNumber: dp.dpNumber,
          dpDate: dp.dpDate,
          dpAmount: dp.dpAmount ?? null,
          dpFileKey: dp.dpFileKey,
          dpFileName: dp.dpFileName,
        })
        .where(eq(paymentRequests.id, id));
    });
  }

  async isInRpLetter(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: rpLetterRequests.paymentRequestId })
      .from(rpLetterRequests)
      .where(eq(rpLetterRequests.paymentRequestId, id))
      .limit(1);
    return !!row;
  }

  async isDpFileOfCounterparty(fileKey: string, counterpartyId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(
        and(
          eq(paymentRequests.dpFileKey, fileKey),
          eq(paymentRequests.counterpartyId, counterpartyId),
        ),
      )
      .limit(1);
    return !!row;
  }

  async listFiles(paymentRequestId: string): Promise<PaymentRequestRow[]> {
    const uploaderCp = alias(counterparties, 'uploader_cp');
    const rows = await this.db
      .select({
        ...getTableColumns(paymentRequestFiles),
        documentTypeName: documentTypes.name,
        uploaderRole: users.role,
        uploaderDepartment: users.departmentId,
        uploaderCounterpartyName: uploaderCp.name,
      })
      .from(paymentRequestFiles)
      .leftJoin(documentTypes, eq(documentTypes.id, paymentRequestFiles.documentTypeId))
      .leftJoin(users, eq(users.id, paymentRequestFiles.createdBy))
      .leftJoin(uploaderCp, eq(uploaderCp.id, users.counterpartyId))
      .where(eq(paymentRequestFiles.paymentRequestId, paymentRequestId))
      .orderBy(asc(paymentRequestFiles.createdAt));
    return rows as PaymentRequestRow[];
  }

  async addFile(paymentRequestId: string, file: AddPaymentRequestFileBody): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(paymentRequestFiles).values({
        paymentRequestId,
        documentTypeId: file.documentTypeId,
        fileName: file.fileName,
        fileKey: file.fileKey,
        fileSize: file.fileSize,
        mimeType: file.mimeType ?? null,
        pageCount: file.pageCount ?? null,
        createdBy: file.userId,
        isResubmit: file.isResubmit ?? false,
        isAdditional: file.isAdditional ?? false,
      });

      const inc: Record<string, unknown> = {
        uploadedFiles: sql`${paymentRequests.uploadedFiles} + 1`,
      };
      if (file.isAdditional || file.isResubmit) {
        inc.totalFiles = sql`${paymentRequests.totalFiles} + 1`;
      }
      await tx.update(paymentRequests).set(inc).where(eq(paymentRequests.id, paymentRequestId));
    });
  }

  async getFileRejection(fileId: string): Promise<boolean | null> {
    const [row] = await this.db
      .select({ isRejected: paymentRequestFiles.isRejected })
      .from(paymentRequestFiles)
      .where(eq(paymentRequestFiles.id, fileId))
      .limit(1);
    return row ? row.isRejected : null;
  }

  async setFileRejection(
    fileId: string,
    isRejected: boolean,
    rejectedBy: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const patch = isRejected
        ? { isRejected: true, rejectedBy, rejectedAt: new Date().toISOString() }
        : { isRejected: false, rejectedBy: null, rejectedAt: null };
      await tx.update(paymentRequestFiles).set(patch).where(eq(paymentRequestFiles.id, fileId));
    });
  }

  async getRequestNumber(id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ requestNumber: paymentRequests.requestNumber })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, id))
      .limit(1);
    return row ? row.requestNumber : null;
  }
}
