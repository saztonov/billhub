/**
 * Read-запросы реестра РП: список реестра, документы для модалки, расчёт статуса оплаты.
 * Вынесены из rp.drizzle.ts (лимит 600 строк на файл). Функции принимают Db/Tx (RpDb).
 */
import { and, eq, inArray, desc, sql } from 'drizzle-orm';
import {
  rpLetters,
  rpLetterRequests,
  paymentRequests,
  paymentPayments,
  suppliers,
  counterparties,
  constructionSites,
  contractRequests,
  contractRequestFiles,
  supplierFoundingDocuments,
  foundingDocumentFiles,
  documentTypes,
} from '../../db/schema/index.js';
import type {
  RpRegistryRow,
  RpRequestRef,
  RpPaymentStatus,
  RpDocumentsResult,
  RpLetterSyncStatus,
} from '../rp.repository.js';
import { countFilesByLetter, type RpDb } from './rp-files.drizzle.js';

/** Вычисляет статус оплаты РП по связанным заявкам. */
export function computePaymentStatus(
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

/** Реестр РП; siteIds=null => все объекты, иначе фильтр по объектам. */
export async function listRegistry(db: RpDb, siteIds: string[] | null): Promise<RpRegistryRow[]> {
  // Пустой список объектов у обычного user => реестр пуст.
  if (siteIds !== null && siteIds.length === 0) return [];

  const letters = await db
    .select({
      id: rpLetters.id,
      number: rpLetters.number,
      letterDate: rpLetters.letterDate,
      createdAt: rpLetters.createdAt,
      sentDate: rpLetters.sentDate,
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
      invoiceNumber: rpLetters.invoiceNumber,
      payhubLetterId: rpLetters.payhubLetterId,
      payhubLetterRegNumber: rpLetters.payhubLetterRegNumber,
      payhubLetterUrl: rpLetters.payhubLetterUrl,
      payhubLetterStatus: rpLetters.payhubLetterStatus,
      payhubLetterError: rpLetters.payhubLetterError,
      payhubLetterPayload: rpLetters.payhubLetterPayload,
    })
    .from(rpLetters)
    .innerJoin(suppliers, eq(suppliers.id, rpLetters.supplierId))
    .innerJoin(counterparties, eq(counterparties.id, rpLetters.counterpartyId))
    .innerJoin(constructionSites, eq(constructionSites.id, rpLetters.siteId))
    .where(siteIds === null ? undefined : inArray(rpLetters.siteId, siteIds))
    .orderBy(desc(rpLetters.createdAt));

  if (letters.length === 0) return [];

  const letterIds = letters.map((l) => l.id);
  const links = await db
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
  const payByLetter = new Map<string, Array<{ invoiceAmount: number | null; totalPaid: number }>>();
  for (const l of links) {
    if (!refsByLetter.has(l.rpLetterId)) refsByLetter.set(l.rpLetterId, []);
    if (!payByLetter.has(l.rpLetterId)) payByLetter.set(l.rpLetterId, []);
    refsByLetter.get(l.rpLetterId)!.push({ id: l.requestId, requestNumber: l.requestNumber });
    payByLetter.get(l.rpLetterId)!.push({ invoiceAmount: l.invoiceAmount, totalPaid: l.totalPaid });
  }

  // Дата оплаты: последний исполненный платёж по заявкам РП (для бейджа «Оплачено»).
  const paidDates = await db
    .select({
      rpLetterId: rpLetterRequests.rpLetterId,
      lastPaidAt: sql<string>`max(${paymentPayments.paymentDate})`,
    })
    .from(rpLetterRequests)
    .innerJoin(
      paymentPayments,
      eq(paymentPayments.paymentRequestId, rpLetterRequests.paymentRequestId),
    )
    .where(
      and(inArray(rpLetterRequests.rpLetterId, letterIds), eq(paymentPayments.isExecuted, true)),
    )
    .groupBy(rpLetterRequests.rpLetterId);
  const paidAtByLetter = new Map(paidDates.map((r) => [r.rpLetterId, r.lastPaidAt]));

  const fileStats = await countFilesByLetter(db, letterIds);

  return letters.map((l) => {
    const paymentStatus = computePaymentStatus(payByLetter.get(l.id) ?? []);
    return {
      ...l,
      totalAmount: l.totalAmount ?? 0,
      payhubLetterStatus: (l.payhubLetterStatus as RpLetterSyncStatus | null) ?? null,
      requests: refsByLetter.get(l.id) ?? [],
      paymentStatus,
      paidAt: paymentStatus === 'paid' ? (paidAtByLetter.get(l.id) ?? null) : null,
      filesCount: fileStats.get(l.id)?.count ?? 0,
      hasRpFile: fileStats.get(l.id)?.hasRpFile ?? false,
    };
  });
}

/** Документы (договор + учредительные поставщика) для модалки создания РП. */
export async function getDocuments(
  db: RpDb,
  supplierId: string,
  counterpartyId: string,
  siteId: string,
): Promise<RpDocumentsResult> {
  // Договорные документы: не зачёркнутые файлы заявок на договор данной связки.
  const contract = await db
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
  const founding = await db
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
