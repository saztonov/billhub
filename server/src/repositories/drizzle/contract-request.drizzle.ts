/**
 * DrizzleRepository для заявок на договор (Iteration 5).
 * Чистый status-state-machine (без approval_decisions); status_history — append jsonb.
 * Записи — в db.transaction(). generate_contract_request_number вызывается внутри транзакции.
 */
import { and, asc, count, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  contractRequests,
  contractRequestFiles,
  statuses,
  counterparties,
  suppliers,
  constructionSites,
  users,
  userConstructionSitesMapping,
} from '../../db/schema/index.js';
import type {
  ContractRequestRepository,
  ContractRequestListFilter,
  ContractRequestRow,
  ContractStatusCounts,
  CreateContractRequestInput,
} from '../contract-request.repository.js';
import type {
  UpdateContractRequestBody,
  ContractDetailsBody,
  AddContractFileBody,
} from '../../schemas/contract-request.js';
import { NotFoundError, ValidationError } from '../types.js';

type Db = PostgresJsDatabase<typeof schema>;
type AnyTx = Parameters<Parameters<Db['transaction']>[0]>[0];

const CONTRACT_PREVIOUS_STATUS: Record<string, string> = {
  on_revision: 'approv_omts',
  approved_waiting: 'approv_omts',
  concluded: 'approved_waiting',
  rejected: 'approv_omts',
};

const UPDATE_FIELD_MAP: Record<
  keyof UpdateContractRequestBody,
  keyof typeof contractRequests.$inferInsert
> = {
  siteId: 'siteId',
  counterpartyId: 'counterpartyId',
  supplierId: 'supplierId',
  partiesCount: 'partiesCount',
  subjectType: 'subjectType',
  subjectDetail: 'subjectDetail',
};

async function statusIdByCode(tx: Db | AnyTx, code: string): Promise<string> {
  const [row] = await tx
    .select({ id: statuses.id })
    .from(statuses)
    .where(and(eq(statuses.entityType, 'contract_request'), eq(statuses.code, code)))
    .limit(1);
  if (!row) throw new Error(`Статус contract_request/${code} не найден`);
  return row.id;
}

export class DrizzleContractRequestRepository implements ContractRequestRepository {
  constructor(private readonly db: Db) {}

  private joined() {
    const statusT = alias(statuses, 'status_t');
    const creatorT = alias(users, 'creator');
    const responsibleT = alias(users, 'responsible');
    return this.db
      .select({
        ...getTableColumns(contractRequests),
        counterpartyName: counterparties.name,
        counterpartyInn: counterparties.inn,
        supplierName: suppliers.name,
        supplierInn: suppliers.inn,
        supplierLastSecurityStatus: suppliers.lastSecurityStatus,
        siteName: constructionSites.name,
        statusName: statusT.name,
        statusColor: statusT.color,
        statusCode: statusT.code,
        creatorFullName: creatorT.fullName,
        responsibleUserFullName: responsibleT.fullName,
      })
      .from(contractRequests)
      .leftJoin(counterparties, eq(counterparties.id, contractRequests.counterpartyId))
      .leftJoin(suppliers, eq(suppliers.id, contractRequests.supplierId))
      .leftJoin(constructionSites, eq(constructionSites.id, contractRequests.siteId))
      .leftJoin(statusT, eq(statusT.id, contractRequests.statusId))
      .leftJoin(creatorT, eq(creatorT.id, contractRequests.createdBy))
      .leftJoin(responsibleT, eq(responsibleT.id, contractRequests.responsibleUserId));
  }

  private async appendHistory(
    tx: AnyTx,
    id: string,
    entry: Record<string, unknown>,
    userId: string,
  ): Promise<void> {
    const [u] = await tx
      .select({ fullName: users.fullName, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const [cur] = await tx
      .select({ statusHistory: contractRequests.statusHistory })
      .from(contractRequests)
      .where(eq(contractRequests.id, id))
      .limit(1);
    const history = ((cur?.statusHistory as Record<string, unknown>[] | null) ?? []).slice();
    history.push({
      ...entry,
      at: new Date().toISOString(),
      userFullName: u?.fullName ?? undefined,
      userEmail: u?.email ?? undefined,
    });
    await tx
      .update(contractRequests)
      .set({ statusHistory: history })
      .where(eq(contractRequests.id, id));
  }

  async getUserSiteIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ siteId: userConstructionSitesMapping.constructionSiteId })
      .from(userConstructionSitesMapping)
      .where(eq(userConstructionSitesMapping.userId, userId));
    return rows.map((r) => r.siteId);
  }

  async list(filter: ContractRequestListFilter): Promise<ContractRequestRow[]> {
    if (filter.siteIds && filter.siteIds.length === 0) return [];
    const conds = [];
    if (!filter.showDeleted) conds.push(eq(contractRequests.isDeleted, false));
    if (filter.counterpartyId)
      conds.push(eq(contractRequests.counterpartyId, filter.counterpartyId));
    if (filter.siteIds && filter.siteIds.length > 0) {
      conds.push(inArray(contractRequests.siteId, filter.siteIds));
    }
    if (filter.supplierId) conds.push(eq(contractRequests.supplierId, filter.supplierId));
    if (filter.siteId) conds.push(eq(contractRequests.siteId, filter.siteId));
    if (filter.statusId) conds.push(eq(contractRequests.statusId, filter.statusId));

    let q = this.joined()
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(contractRequests.createdAt))
      .$dynamic();
    if (filter.pagination) {
      q = q
        .limit(filter.pagination.pageSize)
        .offset((filter.pagination.page - 1) * filter.pagination.pageSize);
    }
    return (await q) as ContractRequestRow[];
  }

  async statusCounts(filter: {
    counterpartyId?: string;
    siteIds?: string[];
  }): Promise<ContractStatusCounts> {
    const codes = ['approv_omts', 'on_revision', 'concluded'] as const;
    const statusRows = await this.db
      .select({ id: statuses.id, code: statuses.code })
      .from(statuses)
      .where(and(eq(statuses.entityType, 'contract_request'), inArray(statuses.code, [...codes])));
    const codeById = new Map<string, string>();
    for (const r of statusRows) codeById.set(r.id, r.code);

    const result: ContractStatusCounts = { approv_omts: 0, on_revision: 0, concluded: 0 };
    if (filter.siteIds && filter.siteIds.length === 0) return result;

    const ids = [...codeById.keys()];
    if (ids.length === 0) return result;

    const conds = [eq(contractRequests.isDeleted, false), inArray(contractRequests.statusId, ids)];
    if (filter.counterpartyId)
      conds.push(eq(contractRequests.counterpartyId, filter.counterpartyId));
    if (filter.siteIds) conds.push(inArray(contractRequests.siteId, filter.siteIds));

    const rows = await this.db
      .select({ statusId: contractRequests.statusId, c: count() })
      .from(contractRequests)
      .where(and(...conds))
      .groupBy(contractRequests.statusId);
    for (const row of rows) {
      const code = codeById.get(row.statusId);
      if (code && code in result) result[code as keyof ContractStatusCounts] = Number(row.c);
    }
    return result;
  }

  async getById(id: string): Promise<ContractRequestRow | null> {
    const [row] = await this.joined().where(eq(contractRequests.id, id)).limit(1);
    return (row as ContractRequestRow) ?? null;
  }

  async getOwnerCounterpartyId(id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ counterpartyId: contractRequests.counterpartyId })
      .from(contractRequests)
      .where(eq(contractRequests.id, id))
      .limit(1);
    return row ? row.counterpartyId : null;
  }

  async getStatusGate(
    id: string,
  ): Promise<{ counterpartyId: string | null; statusCode: string | null } | null> {
    const [row] = await this.db
      .select({ counterpartyId: contractRequests.counterpartyId, statusCode: statuses.code })
      .from(contractRequests)
      .leftJoin(statuses, eq(statuses.id, contractRequests.statusId))
      .where(eq(contractRequests.id, id))
      .limit(1);
    if (!row) return null;
    return { counterpartyId: row.counterpartyId, statusCode: row.statusCode ?? null };
  }

  async getSupplierId(id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ supplierId: contractRequests.supplierId })
      .from(contractRequests)
      .where(eq(contractRequests.id, id))
      .limit(1);
    return row ? row.supplierId : null;
  }

  async create(
    input: CreateContractRequestInput,
  ): Promise<{ requestId: string; requestNumber: string }> {
    return this.db.transaction(async (tx) => {
      const statusId = await statusIdByCode(tx, 'approv_omts');
      const numRows = (await tx.execute(
        sql`select generate_contract_request_number() as num`,
      )) as unknown as { num: string }[];
      const requestNumber = numRows[0]!.num;
      const [created] = await tx
        .insert(contractRequests)
        .values({
          requestNumber,
          siteId: input.siteId,
          counterpartyId: input.counterpartyId,
          supplierId: input.supplierId,
          partiesCount: input.partiesCount,
          subjectType: input.subjectType,
          subjectDetail: input.subjectDetail || null,
          statusId,
          createdBy: input.createdBy,
        })
        .returning({ id: contractRequests.id });
      const requestId = created!.id;
      await this.appendHistory(tx, requestId, { event: 'created' }, input.createdBy);
      return { requestId, requestNumber };
    });
  }

  async update(
    id: string,
    patch: UpdateContractRequestBody,
    opts: { stripCounterparty: boolean },
  ): Promise<void> {
    const updateData: Partial<typeof contractRequests.$inferInsert> = {};
    const body = patch as Record<string, unknown>;
    for (const camel of Object.keys(UPDATE_FIELD_MAP) as (keyof UpdateContractRequestBody)[]) {
      if (body[camel] !== undefined) {
        (updateData as Record<string, unknown>)[UPDATE_FIELD_MAP[camel]] = body[camel];
      }
    }
    if (opts.stripCounterparty) delete updateData.counterpartyId;
    if (Object.keys(updateData).length === 0) return;
    await this.db.transaction(async (tx) => {
      await tx.update(contractRequests).set(updateData).where(eq(contractRequests.id, id));
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(contractRequests)
        .set({ isDeleted: true, deletedAt: new Date().toISOString() })
        .where(eq(contractRequests.id, id));
    });
  }

  async setContractDetails(id: string, body: ContractDetailsBody): Promise<void> {
    const updateData: Partial<typeof contractRequests.$inferInsert> = {};
    if (body.contractNumber !== undefined) updateData.contractNumber = body.contractNumber;
    if (body.contractSigningDate !== undefined) {
      updateData.contractSigningDate = body.contractSigningDate;
    }
    if (Object.keys(updateData).length === 0) return;
    await this.db.transaction(async (tx) => {
      await tx.update(contractRequests).set(updateData).where(eq(contractRequests.id, id));
    });
  }

  async sendToRevision(id: string, targets: string[], userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const statusId = await statusIdByCode(tx, 'on_revision');
      await tx
        .update(contractRequests)
        .set({ statusId, revisionTargets: targets })
        .where(eq(contractRequests.id, id));
      await this.appendHistory(tx, id, { event: 'revision', revisionTargets: targets }, userId);
    });
  }

  async completeRevision(id: string, target: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [cur] = await tx
        .select({ revisionTargets: contractRequests.revisionTargets })
        .from(contractRequests)
        .where(eq(contractRequests.id, id))
        .limit(1);
      if (!cur) throw new NotFoundError('ContractRequest', id);
      const newTargets = (cur.revisionTargets ?? []).filter((t) => t !== target);
      if (newTargets.length === 0) {
        const statusId = await statusIdByCode(tx, 'approv_omts');
        await tx
          .update(contractRequests)
          .set({ statusId, revisionTargets: [] })
          .where(eq(contractRequests.id, id));
      } else {
        await tx
          .update(contractRequests)
          .set({ revisionTargets: newTargets })
          .where(eq(contractRequests.id, id));
      }
      await this.appendHistory(
        tx,
        id,
        { event: 'revision_complete', revisionTarget: target },
        userId,
      );
    });
  }

  async approve(id: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const statusId = await statusIdByCode(tx, 'approved_waiting');
      await tx
        .update(contractRequests)
        .set({ statusId, revisionTargets: [] })
        .where(eq(contractRequests.id, id));
      await this.appendHistory(tx, id, { event: 'approved' }, userId);
    });
  }

  async markOriginalReceived(id: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const statusId = await statusIdByCode(tx, 'concluded');
      await tx
        .update(contractRequests)
        .set({ statusId, originalReceivedAt: new Date().toISOString() })
        .where(eq(contractRequests.id, id));
      await this.appendHistory(tx, id, { event: 'original_received' }, userId);
    });
  }

  async revertToPrevious(id: string, userId: string, comment?: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [cur] = await tx
        .select({ statusCode: statuses.code })
        .from(contractRequests)
        .leftJoin(statuses, eq(statuses.id, contractRequests.statusId))
        .where(eq(contractRequests.id, id))
        .limit(1);
      if (!cur) throw new NotFoundError('ContractRequest', id);
      const currentCode = cur.statusCode ?? undefined;
      const targetCode = currentCode ? CONTRACT_PREVIOUS_STATUS[currentCode] : undefined;
      if (!targetCode) throw new ValidationError('Для текущего статуса нет предыдущего этапа');

      const statusId = await statusIdByCode(tx, targetCode);
      const [target] = await tx
        .select({ name: statuses.name })
        .from(statuses)
        .where(and(eq(statuses.entityType, 'contract_request'), eq(statuses.code, targetCode)))
        .limit(1);
      const toStatusName = target?.name ?? targetCode;

      const updateData: Partial<typeof contractRequests.$inferInsert> = { statusId };
      if (currentCode === 'concluded') updateData.originalReceivedAt = null;
      if (targetCode === 'approv_omts') updateData.revisionTargets = [];
      await tx.update(contractRequests).set(updateData).where(eq(contractRequests.id, id));

      const trimmed = comment?.trim() || null;
      await this.appendHistory(
        tx,
        id,
        { event: 'status_reverted', toStatusName, ...(trimmed ? { comment: trimmed } : {}) },
        userId,
      );
    });
  }

  async reject(id: string, userId: string, comment: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [cur] = await tx
        .select({ statusCode: statuses.code })
        .from(contractRequests)
        .leftJoin(statuses, eq(statuses.id, contractRequests.statusId))
        .where(eq(contractRequests.id, id))
        .limit(1);
      if (!cur) throw new NotFoundError('ContractRequest', id);
      if (cur.statusCode === 'concluded' || cur.statusCode === 'rejected') {
        throw new ValidationError('Заявку в этом статусе нельзя отклонить');
      }
      const statusId = await statusIdByCode(tx, 'rejected');
      await tx.update(contractRequests).set({ statusId }).where(eq(contractRequests.id, id));
      await this.appendHistory(tx, id, { event: 'rejected', comment }, userId);
    });
  }

  async assign(id: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(contractRequests)
        .set({ responsibleUserId: userId })
        .where(eq(contractRequests.id, id));
      await this.appendHistory(tx, id, { event: 'assigned' }, userId);
    });
  }

  async listFiles(contractRequestId: string): Promise<ContractRequestRow[]> {
    const uploaderCp = alias(counterparties, 'uploader_cp');
    const rows = await this.db
      .select({
        ...getTableColumns(contractRequestFiles),
        uploaderRole: users.role,
        uploaderDepartment: users.departmentId,
        uploaderCounterpartyName: uploaderCp.name,
      })
      .from(contractRequestFiles)
      .leftJoin(users, eq(users.id, contractRequestFiles.createdBy))
      .leftJoin(uploaderCp, eq(uploaderCp.id, users.counterpartyId))
      .where(eq(contractRequestFiles.contractRequestId, contractRequestId))
      .orderBy(asc(contractRequestFiles.createdAt));
    return rows as ContractRequestRow[];
  }

  async addFile(contractRequestId: string, file: AddContractFileBody): Promise<void> {
    await this.db.transaction(async (tx) => {
      let isSignedContract = false;
      if (file.isSignedContract) {
        const [cr] = await tx
          .select({ code: statuses.code })
          .from(contractRequests)
          .leftJoin(statuses, eq(statuses.id, contractRequests.statusId))
          .where(eq(contractRequests.id, contractRequestId))
          .limit(1);
        if (cr?.code === 'approved_waiting' || cr?.code === 'concluded') isSignedContract = true;
      }
      await tx.insert(contractRequestFiles).values({
        contractRequestId,
        fileName: file.fileName,
        fileKey: file.fileKey,
        fileSize: file.fileSize,
        mimeType: file.mimeType ?? null,
        createdBy: file.userId,
        isAdditional: file.isAdditional ?? false,
        isSignedContract,
      });
    });
  }

  async getFileRejection(fileId: string): Promise<boolean | null> {
    const [row] = await this.db
      .select({ isRejected: contractRequestFiles.isRejected })
      .from(contractRequestFiles)
      .where(eq(contractRequestFiles.id, fileId))
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
      await tx.update(contractRequestFiles).set(patch).where(eq(contractRequestFiles.id, fileId));
    });
  }

  async setSignedContract(fileId: string, isSignedContract: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(contractRequestFiles)
        .set({ isSignedContract })
        .where(eq(contractRequestFiles.id, fileId));
    });
  }
}
