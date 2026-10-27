/**
 * Автосоздание РП при финальном согласовании заявки на этапе «РП» (stage 4).
 * Одна РП на заявку; письмо PayHub создаётся в статусе pending и доводится воркером
 * синхронизации (как ручное создание). Вложения письма — все незачёркнутые файлы заявки,
 * договорные документы связки и учредительные документы поставщика; тот же набор документов
 * сохраняется снимком в rp_letter_documents.
 * Вложения ссылаются на исходные ключи S3 без копирования: удаление РП удаляет из S3 только
 * файлы папки rp-letters/<id>/, исходные файлы не трогаются.
 */
import { and, asc, eq } from 'drizzle-orm';
import {
  paymentRequests,
  paymentRequestFiles,
  rpLetterAttachments,
  rpLetterRequests,
  suppliers,
} from '../../db/schema/index.js';
import type { RpAutoCreateOutcome, RpDocumentRef } from '../rp.repository.js';
import { getRpAutoCreateEnabled } from '../../services/rp/rp-auto-create-setting.js';
import {
  RP_LETTER_DEFAULT_SUBJECT,
  buildRpLetterContent,
  moscowToday,
} from '../../services/rp/rp-letter-content.js';
import { insertRpTx } from './rp-create.drizzle.js';
import { getDocuments } from './rp-registry.drizzle.js';
import type { RpDb } from './rp-files.drizzle.js';

export interface AutoRpInput {
  paymentRequestId: string;
  /** Согласовавший на этапе «РП» — автор РП и ответственный в письме. */
  approverId: string;
  approverFullName: string | null;
}

/** Файл-кандидат во вложения письма. */
interface AttachmentSource {
  fileKey: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

/** Создаёт РП для согласованной заявки в транзакции tx (без перехвата ошибок). */
export async function createAutoRpTx(tx: RpDb, input: AutoRpInput): Promise<RpAutoCreateOutcome> {
  if (!(await getRpAutoCreateEnabled(tx))) return { status: 'skipped', reason: 'disabled' };

  const [pr] = await tx
    .select({
      supplierId: paymentRequests.supplierId,
      counterpartyId: paymentRequests.counterpartyId,
      siteId: paymentRequests.siteId,
      invoiceAmount: paymentRequests.invoiceAmount,
      comment: paymentRequests.comment,
      dpNumber: paymentRequests.dpNumber,
      supplierName: suppliers.name,
    })
    .from(paymentRequests)
    .leftJoin(suppliers, eq(suppliers.id, paymentRequests.supplierId))
    .where(eq(paymentRequests.id, input.paymentRequestId))
    .limit(1);
  if (!pr) throw new Error('Заявка не найдена');

  // Заявка уже в РП (повторное согласование после доработки) — ничего не делаем.
  const [linked] = await tx
    .select({ rpLetterId: rpLetterRequests.rpLetterId })
    .from(rpLetterRequests)
    .where(eq(rpLetterRequests.paymentRequestId, input.paymentRequestId))
    .limit(1);
  if (pr.dpNumber || linked) return { status: 'skipped', reason: 'already_linked' };

  // Договорные и учредительные документы — только при наличии поставщика.
  const docs = pr.supplierId
    ? await getDocuments(tx, pr.supplierId, pr.counterpartyId, pr.siteId)
    : { contract: [], founding: [] };
  const documents: RpDocumentRef[] = [
    ...docs.contract.map((d) => ({
      source: 'contract' as const,
      fileKey: d.fileKey,
      fileName: d.fileName,
      mimeType: d.mimeType,
      contractNumber: d.contractNumber,
      contractDate: d.contractDate,
    })),
    ...docs.founding.map((d) => ({
      source: 'founding' as const,
      fileKey: d.fileKey,
      fileName: d.fileName,
      mimeType: d.mimeType,
    })),
  ];

  const rpLetterId = await insertRpTx(tx, {
    supplierId: pr.supplierId,
    counterpartyId: pr.counterpartyId,
    siteId: pr.siteId,
    paymentRequestIds: [input.paymentRequestId],
    documents,
    letterDate: moscowToday(),
    invoiceNumber: null,
    createdBy: input.approverId,
    letter: {
      subject: RP_LETTER_DEFAULT_SUBJECT,
      content: buildRpLetterContent([
        { invoiceAmount: pr.invoiceAmount, supplierName: pr.supplierName, comment: pr.comment },
      ]),
      responsiblePersonName: input.approverFullName,
    },
    letterInitialStatus: 'pending',
  });

  const requestFiles = await tx
    .select({
      fileKey: paymentRequestFiles.fileKey,
      fileName: paymentRequestFiles.fileName,
      mimeType: paymentRequestFiles.mimeType,
      sizeBytes: paymentRequestFiles.fileSize,
    })
    .from(paymentRequestFiles)
    .where(
      and(
        eq(paymentRequestFiles.paymentRequestId, input.paymentRequestId),
        eq(paymentRequestFiles.isRejected, false),
      ),
    )
    .orderBy(asc(paymentRequestFiles.createdAt));

  const sources: AttachmentSource[] = [
    ...requestFiles,
    ...documents.map((d) => ({
      fileKey: d.fileKey,
      fileName: d.fileName,
      mimeType: d.mimeType ?? null,
      sizeBytes: null,
    })),
  ];
  // Один ключ — одно вложение (уникальность rp_letter_id + file_key).
  const unique = [...new Map(sources.map((s) => [s.fileKey, s])).values()];
  if (unique.length > 0) {
    await tx
      .insert(rpLetterAttachments)
      .values(
        unique.map((s) => ({
          rpLetterId,
          fileKey: s.fileKey,
          fileName: s.fileName,
          mimeType: s.mimeType,
          sizeBytes: s.sizeBytes,
          fileType: 'other',
        })),
      )
      .onConflictDoNothing();
  }

  return { status: 'created', rpLetterId };
}

/**
 * Автосоздание РП внутри транзакции согласования в savepoint: сбой откатывает только
 * savepoint и возвращается как failed — согласование заявки при этом проходит.
 */
export async function tryCreateAutoRpTx(
  tx: RpDb,
  input: AutoRpInput,
): Promise<RpAutoCreateOutcome> {
  try {
    return await tx.transaction((sp) => createAutoRpTx(sp, input));
  } catch (err) {
    // Ошибка БД приходит обёрнутой drizzle («Failed query: …» с параметрами) — берём причину.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    return { status: 'failed', error: cause instanceof Error ? cause.message : String(cause) };
  }
}
