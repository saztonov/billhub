/**
 * DrizzleRpRepository — реестр распределительных писем (РП). Введён миграцией 0006.
 * Только Drizzle (без Supabase).
 */
import { and, eq, inArray, desc, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  rpLetters,
  rpLetterRequests,
  rpLetterDocuments,
  rpLetterAttachments,
  paymentRequests,
  suppliers,
  counterparties,
  constructionSites,
  contractRequests,
  contractRequestFiles,
  supplierFoundingDocuments,
  foundingDocumentFiles,
  documentTypes,
} from '../../db/schema/index.js';
import { ValidationError, NotFoundError } from '../types.js';
import type {
  RpRepository,
  RpRegistryRow,
  RpRequestRef,
  RpPaymentStatus,
  RpDocumentsResult,
  CreateRpInput,
  RpLetterAttachmentRef,
  RpLetterSyncContext,
  RpLetterSyncStatus,
  RpLetterSyncedResult,
} from '../rp.repository.js';

type Db = PostgresJsDatabase<typeof schema>;

/** Вычисляет статус оплаты РП по связанным заявкам. */
function computePaymentStatus(
  reqs: Array<{ invoiceAmount: number | null; totalPaid: number }>,
): RpPaymentStatus {
  if (reqs.length === 0) return 'unpaid';
  const isPaid = (r: { invoiceAmount: number | null; totalPaid: number }) =>
    r.invoiceAmount != null && r.invoiceAmount > 0 && r.totalPaid >= r.invoiceAmount;
  const hasPayment = (r: { invoiceAmount: number | null; totalPaid: number }) => r.totalPaid > 0;

  if (reqs.every(isPaid)) return 'paid';
  if (reqs.some((r) => isPaid(r) || hasPayment(r))) return 'partial';
  return 'unpaid';
}

export class DrizzleRpRepository implements RpRepository {
  constructor(private readonly db: Db) {}

  async listRegistry(siteIds: string[] | null): Promise<RpRegistryRow[]> {
    // Пустой список объектов у обычного user => реестр пуст.
    if (siteIds !== null && siteIds.length === 0) return [];

    const letters = await this.db
      .select({
        id: rpLetters.id,
        number: rpLetters.number,
        letterDate: rpLetters.letterDate,
        createdAt: rpLetters.createdAt,
        status: rpLetters.status,
        totalAmount: rpLetters.totalAmount,
        description: rpLetters.description,
        supplierId: rpLetters.supplierId,
        supplierName: suppliers.name,
        supplierInn: suppliers.inn,
        counterpartyId: rpLetters.counterpartyId,
        counterpartyName: counterparties.name,
        counterpartyInn: counterparties.inn,
        siteId: rpLetters.siteId,
        siteName: constructionSites.name,
        createdBy: rpLetters.createdBy,
        payhubLetterId: rpLetters.payhubLetterId,
        payhubLetterRegNumber: rpLetters.payhubLetterRegNumber,
        payhubLetterUrl: rpLetters.payhubLetterUrl,
        payhubLetterStatus: rpLetters.payhubLetterStatus,
        payhubLetterError: rpLetters.payhubLetterError,
      })
      .from(rpLetters)
      .innerJoin(suppliers, eq(suppliers.id, rpLetters.supplierId))
      .innerJoin(counterparties, eq(counterparties.id, rpLetters.counterpartyId))
      .innerJoin(constructionSites, eq(constructionSites.id, rpLetters.siteId))
      .where(siteIds === null ? undefined : inArray(rpLetters.siteId, siteIds))
      .orderBy(desc(rpLetters.createdAt));

    if (letters.length === 0) return [];

    const letterIds = letters.map((l) => l.id);
    const links = await this.db
      .select({
        rpLetterId: rpLetterRequests.rpLetterId,
        requestId: paymentRequests.id,
        requestNumber: paymentRequests.requestNumber,
        invoiceAmount: paymentRequests.invoiceAmount,
        totalPaid: paymentRequests.totalPaid,
      })
      .from(rpLetterRequests)
      .innerJoin(paymentRequests, eq(paymentRequests.id, rpLetterRequests.paymentRequestId))
      .where(inArray(rpLetterRequests.rpLetterId, letterIds));

    const refsByLetter = new Map<string, RpRequestRef[]>();
    const payByLetter = new Map<
      string,
      Array<{ invoiceAmount: number | null; totalPaid: number }>
    >();
    for (const l of links) {
      if (!refsByLetter.has(l.rpLetterId)) refsByLetter.set(l.rpLetterId, []);
      if (!payByLetter.has(l.rpLetterId)) payByLetter.set(l.rpLetterId, []);
      refsByLetter.get(l.rpLetterId)!.push({ id: l.requestId, requestNumber: l.requestNumber });
      payByLetter
        .get(l.rpLetterId)!
        .push({ invoiceAmount: l.invoiceAmount, totalPaid: l.totalPaid });
    }

    return letters.map((l) => ({
      ...l,
      totalAmount: l.totalAmount ?? 0,
      payhubLetterStatus: (l.payhubLetterStatus as RpLetterSyncStatus | null) ?? null,
      requests: refsByLetter.get(l.id) ?? [],
      paymentStatus: computePaymentStatus(payByLetter.get(l.id) ?? []),
    }));
  }

  async getDocuments(
    supplierId: string,
    counterpartyId: string,
    siteId: string,
  ): Promise<RpDocumentsResult> {
    // Договорные документы: не зачёркнутые файлы заявок на договор данной связки.
    const contract = await this.db
      .select({
        id: contractRequestFiles.id,
        fileKey: contractRequestFiles.fileKey,
        fileName: contractRequestFiles.fileName,
        mimeType: contractRequestFiles.mimeType,
        contractNumber: contractRequests.contractNumber,
        contractDate: contractRequests.contractSigningDate,
        isSignedContract: contractRequestFiles.isSignedContract,
      })
      .from(contractRequestFiles)
      .innerJoin(contractRequests, eq(contractRequests.id, contractRequestFiles.contractRequestId))
      .where(
        and(
          eq(contractRequests.supplierId, supplierId),
          eq(contractRequests.counterpartyId, counterpartyId),
          eq(contractRequests.siteId, siteId),
          eq(contractRequests.isDeleted, false),
          eq(contractRequestFiles.isRejected, false),
        ),
      )
      .orderBy(desc(contractRequestFiles.createdAt));

    // Учредительные документы поставщика.
    const founding = await this.db
      .select({
        id: foundingDocumentFiles.id,
        fileKey: foundingDocumentFiles.fileKey,
        fileName: foundingDocumentFiles.fileName,
        mimeType: foundingDocumentFiles.mimeType,
        typeName: documentTypes.name,
      })
      .from(foundingDocumentFiles)
      .innerJoin(
        supplierFoundingDocuments,
        eq(supplierFoundingDocuments.id, foundingDocumentFiles.supplierFoundingDocumentId),
      )
      .innerJoin(
        documentTypes,
        eq(documentTypes.id, supplierFoundingDocuments.foundingDocumentTypeId),
      )
      .where(eq(supplierFoundingDocuments.supplierId, supplierId))
      .orderBy(desc(foundingDocumentFiles.createdAt));

    return { contract, founding };
  }

  async create(input: CreateRpInput): Promise<RpRegistryRow> {
    const { supplierId, counterpartyId, siteId, paymentRequestIds, documents, createdBy } = input;

    if (paymentRequestIds.length === 0) {
      throw new ValidationError('Не выбрано ни одной заявки для РП');
    }

    const newId = await this.db.transaction(async (tx) => {
      // Загружаем выбранные заявки для валидации связки/статуса и расчёта суммы/описания.
      const reqs = await tx
        .select({
          id: paymentRequests.id,
          supplierId: paymentRequests.supplierId,
          counterpartyId: paymentRequests.counterpartyId,
          siteId: paymentRequests.siteId,
          invoiceAmount: paymentRequests.invoiceAmount,
          comment: paymentRequests.comment,
          approvedAt: paymentRequests.approvedAt,
          rejectedAt: paymentRequests.rejectedAt,
          withdrawnAt: paymentRequests.withdrawnAt,
          isDeleted: paymentRequests.isDeleted,
        })
        .from(paymentRequests)
        .where(inArray(paymentRequests.id, paymentRequestIds));

      if (reqs.length !== paymentRequestIds.length) {
        throw new ValidationError('Некоторые заявки не найдены');
      }
      for (const r of reqs) {
        if (r.isDeleted) throw new ValidationError('Нельзя включить удалённую заявку в РП');
        if (!r.approvedAt || r.rejectedAt || r.withdrawnAt) {
          throw new ValidationError('В РП можно включать только согласованные заявки');
        }
        if (
          r.supplierId !== supplierId ||
          r.counterpartyId !== counterpartyId ||
          r.siteId !== siteId
        ) {
          throw new ValidationError(
            'Все заявки РП должны быть с одним Поставщиком, Подрядчиком и Объектом',
          );
        }
      }

      // Проверка, что заявки ещё не входят в другую РП.
      const existing = await tx
        .select({ paymentRequestId: rpLetterRequests.paymentRequestId })
        .from(rpLetterRequests)
        .where(inArray(rpLetterRequests.paymentRequestId, paymentRequestIds));
      if (existing.length > 0) {
        throw new ValidationError('Некоторые заявки уже включены в другую РП');
      }

      const totalAmount = reqs.reduce((sum, r) => sum + (r.invoiceAmount ?? 0), 0);
      const description = reqs
        .map((r) => (r.comment ?? '').trim())
        .filter((c) => c.length > 0)
        .join('; ');

      // Сквозной номер РП формата РП-000001.
      const seq = await tx.execute(sql`SELECT nextval('public.rp_letters_number_seq') AS n`);
      const n = Number((seq as unknown as Array<{ n: string | number }>)[0]?.n ?? 0);
      const number = `РП-${String(n).padStart(6, '0')}`;

      // Письмо PayHub: снимок формы + начальный статус синхронизации (0008).
      const letterFields = input.letter
        ? {
            payhubLetterPayload: input.letter,
            payhubLetterStatus: input.letterInitialStatus ?? 'pending',
            payhubLetterStatusUpdatedAt: sql`now()`,
          }
        : {};

      const [letter] = await tx
        .insert(rpLetters)
        .values({
          number,
          letterDate: input.letterDate ?? null,
          supplierId,
          counterpartyId,
          siteId,
          totalAmount,
          description,
          status: 'draft',
          createdBy,
          ...letterFields,
        })
        .returning({ id: rpLetters.id });

      const rpLetterId = letter!.id;

      await tx
        .insert(rpLetterRequests)
        .values(paymentRequestIds.map((pid) => ({ rpLetterId, paymentRequestId: pid })));

      if (documents.length > 0) {
        await tx.insert(rpLetterDocuments).values(
          documents.map((d) => ({
            rpLetterId,
            source: d.source,
            fileKey: d.fileKey,
            fileName: d.fileName,
            mimeType: d.mimeType ?? null,
            contractNumber: d.contractNumber ?? null,
            contractDate: d.contractDate ?? null,
          })),
        );
      }

      return rpLetterId;
    });

    // Возвращаем готовую строку реестра (single-row scope).
    const [row] = await this.listRegistry(null).then((rows) => rows.filter((r) => r.id === newId));
    if (!row) throw new NotFoundError('РП', newId);
    return row;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const res = await this.db
      .update(rpLetters)
      .set({ status })
      .where(eq(rpLetters.id, id))
      .returning({ id: rpLetters.id });
    if (res.length === 0) throw new NotFoundError('РП', id);
  }

  async getRpSiteId(id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ siteId: rpLetters.siteId })
      .from(rpLetters)
      .where(eq(rpLetters.id, id))
      .limit(1);
    return row?.siteId ?? null;
  }

  /* ------------------------------------------------------------------ */
  /*  Письмо PayHub (0008)                                               */
  /* ------------------------------------------------------------------ */

  async addLetterAttachments(rpLetterId: string, refs: RpLetterAttachmentRef[]): Promise<void> {
    if (refs.length === 0) return;
    // Транзакция с блокировкой строки письма (FOR UPDATE): сериализует регистрацию
    // вложений с finalize и параллельными батчами — окно «insert после чтения
    // контекста воркером» и обход лимита 20 исключены.
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ status: rpLetters.payhubLetterStatus })
        .from(rpLetters)
        .where(eq(rpLetters.id, rpLetterId))
        .for('update')
        .limit(1);
      if (!row) throw new NotFoundError('РП', rpLetterId);
      if (row.status !== 'uploading') {
        throw new ValidationError('Файлы письма можно регистрировать только до его отправки');
      }
      // Уже зарегистрированные ключи — чтобы повтор тех же файлов не считался за лимит.
      const existing = await tx
        .select({ fileKey: rpLetterAttachments.fileKey })
        .from(rpLetterAttachments)
        .where(eq(rpLetterAttachments.rpLetterId, rpLetterId));
      const existingKeys = new Set(existing.map((e) => e.fileKey));
      const newRefs = refs.filter((r) => !existingKeys.has(r.fileKey));
      if (newRefs.length === 0) return; // всё уже зарегистрировано — идемпотентно
      if (existingKeys.size + newRefs.length > 20) {
        throw new ValidationError('Не больше 20 файлов на письмо');
      }
      // onConflictDoNothing по (rp_letter_id, file_key) — идемпотентность при гонке
      // (параллельный батч мог вставить тот же ключ между select и insert).
      await tx
        .insert(rpLetterAttachments)
        .values(
          newRefs.map((r) => ({
            rpLetterId,
            fileKey: r.fileKey,
            fileName: r.fileName,
            mimeType: r.mimeType ?? null,
            sizeBytes: r.sizeBytes ?? null,
          })),
        )
        .onConflictDoNothing({
          target: [rpLetterAttachments.rpLetterId, rpLetterAttachments.fileKey],
        });
    });
  }

  async finalizeLetter(rpLetterId: string): Promise<void> {
    // FOR UPDATE — сериализация с addLetterAttachments: finalize дождётся коммита
    // регистрации вложений, воркер не прочитает контекст раньше вставки.
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ status: rpLetters.payhubLetterStatus, payload: rpLetters.payhubLetterPayload })
        .from(rpLetters)
        .where(eq(rpLetters.id, rpLetterId))
        .for('update')
        .limit(1);
      if (!row) throw new NotFoundError('РП', rpLetterId);
      if (row.status === 'synced') throw new ValidationError('Письмо уже создано в PayHub');
      if (row.status === null || !row.payload) {
        throw new ValidationError('Для этой РП письмо не оформлялось');
      }
      if (row.status === 'pending') return; // уже в очереди — идемпотентно
      await tx
        .update(rpLetters)
        .set({
          payhubLetterStatus: 'pending',
          payhubLetterError: null,
          payhubLetterStatusUpdatedAt: sql`now()`,
        })
        .where(eq(rpLetters.id, rpLetterId));
    });
  }

  async getLetterSyncContext(rpLetterId: string): Promise<RpLetterSyncContext | null> {
    const [row] = await this.db
      .select({
        id: rpLetters.id,
        number: rpLetters.number,
        letterDate: rpLetters.letterDate,
        payload: rpLetters.payhubLetterPayload,
        payhubLetterId: rpLetters.payhubLetterId,
        payhubLetterUrl: rpLetters.payhubLetterUrl,
        payhubLetterStatus: rpLetters.payhubLetterStatus,
        sitePayhubProjectId: constructionSites.payhubProjectId,
        sitePayhubContractorId: constructionSites.payhubContractorId,
      })
      .from(rpLetters)
      .innerJoin(constructionSites, eq(constructionSites.id, rpLetters.siteId))
      .where(eq(rpLetters.id, rpLetterId))
      .limit(1);
    if (!row) return null;

    const attachments = await this.db
      .select({
        id: rpLetterAttachments.id,
        fileKey: rpLetterAttachments.fileKey,
        fileName: rpLetterAttachments.fileName,
        mimeType: rpLetterAttachments.mimeType,
        sizeBytes: rpLetterAttachments.sizeBytes,
        payhubAttachmentId: rpLetterAttachments.payhubAttachmentId,
      })
      .from(rpLetterAttachments)
      .where(eq(rpLetterAttachments.rpLetterId, rpLetterId));

    return {
      ...row,
      payhubLetterStatus: (row.payhubLetterStatus as RpLetterSyncStatus | null) ?? null,
      attachments,
    };
  }

  async recordLetterSyncAttempt(rpLetterId: string): Promise<void> {
    await this.db
      .update(rpLetters)
      .set({
        payhubLetterSyncAttempts: sql`${rpLetters.payhubLetterSyncAttempts} + 1`,
        payhubLetterStatusUpdatedAt: sql`now()`,
      })
      .where(eq(rpLetters.id, rpLetterId));
  }

  async setLetterSyncStatus(
    rpLetterId: string,
    status: RpLetterSyncStatus,
    error?: string | null,
  ): Promise<void> {
    await this.db
      .update(rpLetters)
      .set({
        payhubLetterStatus: status,
        payhubLetterError: error ?? null,
        payhubLetterStatusUpdatedAt: sql`now()`,
      })
      .where(eq(rpLetters.id, rpLetterId));
  }

  async setLetterLinked(rpLetterId: string, result: RpLetterSyncedResult): Promise<void> {
    await this.db
      .update(rpLetters)
      .set({
        payhubLetterId: result.payhubLetterId,
        payhubLetterRegNumber: result.payhubLetterRegNumber,
        payhubLetterUrl: result.payhubLetterUrl,
        payhubLetterStatusUpdatedAt: sql`now()`,
      })
      .where(eq(rpLetters.id, rpLetterId));
  }

  async setLetterSynced(rpLetterId: string, result: RpLetterSyncedResult): Promise<void> {
    await this.db
      .update(rpLetters)
      .set({
        payhubLetterId: result.payhubLetterId,
        payhubLetterRegNumber: result.payhubLetterRegNumber,
        payhubLetterUrl: result.payhubLetterUrl,
        payhubLetterStatus: 'synced',
        payhubLetterError: null,
        payhubLetterStatusUpdatedAt: sql`now()`,
      })
      .where(eq(rpLetters.id, rpLetterId));
  }

  async setAttachmentPayhubId(attachmentId: string, payhubAttachmentId: string): Promise<void> {
    await this.db
      .update(rpLetterAttachments)
      .set({ payhubAttachmentId })
      .where(eq(rpLetterAttachments.id, attachmentId));
  }

  async listLetterSyncCandidates(statuses: RpLetterSyncStatus[]): Promise<string[]> {
    if (statuses.length === 0) return [];
    const rows = await this.db
      .select({ id: rpLetters.id })
      .from(rpLetters)
      .where(inArray(rpLetters.payhubLetterStatus, statuses));
    return rows.map((r) => r.id);
  }
}
