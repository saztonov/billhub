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
}
