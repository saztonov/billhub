/**
 * Хелперы файлов РП и связки поля «РП» заявок (миграция 0010).
 * Вынесены из rp.drizzle.ts (лимит 600 строк на файл). Функции принимают Db ИЛИ Tx —
 * dp-функции обязаны вызываться внутри транзакции родительской мутации (атомарность).
 */
import { and, eq, inArray, asc, sql } from 'drizzle-orm';
import type { PostgresJsDatabase, PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import {
  rpLetters,
  rpLetterAttachments,
  rpLetterServiceFiles,
  rpLetterRequests,
  paymentRequests,
  paymentRequestFiles,
} from '../../db/schema/index.js';
import type {
  RpFilesResult,
  RpServiceFileRef,
  RpInvoiceCandidateGroup,
  RpInvoiceFileMeta,
} from '../rp.repository.js';

/** ID типа документа «Счёт» (продублирован в OCR/materials/фронте). */
const INVOICE_DOC_TYPE_ID = 'c3c0b242-8a0c-4e20-b9ad-363ebf462a5b';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
/** Db или транзакция — оба поддерживают билдеры select/insert/update/delete/execute. */
export type RpDb = Db | Tx;

/* ------------------------------------------------------------------ */
/*  Связка РП -> поле «РП» заявок (payment_requests.dp_*)              */
/* ------------------------------------------------------------------ */

/** Подзапрос id заявок, входящих в РП. */
const linkedRequestIds = (rpLetterId: string) =>
  sql`SELECT payment_request_id FROM public.rp_letter_requests WHERE rp_letter_id = ${rpLetterId}`;

/**
 * Проставить связанным заявкам номер/дату РП (рег.номер письма PayHub + его дата) и
 * сумму заявки. Вызывать только при наличии рег.номера (иначе «пустой РП» в заявке).
 */
export async function propagateDpNumberDate(
  tx: RpDb,
  rpLetterId: string,
  regNumber: string,
  letterDate: string | null,
): Promise<void> {
  await tx.execute(sql`
    UPDATE public.payment_requests AS pr
       SET dp_number = ${regNumber},
           dp_date   = ${letterDate}::date,
           dp_amount = pr.invoice_amount
     WHERE pr.id IN (${linkedRequestIds(rpLetterId)})
  `);
}

/** Проставить связанным заявкам файл РП (скан чистовика — вложение письма типа 'rp'). */
export async function propagateDpFile(
  tx: RpDb,
  rpLetterId: string,
  fileKey: string,
  fileName: string,
): Promise<void> {
  await tx.execute(sql`
    UPDATE public.payment_requests
       SET dp_file_key = ${fileKey}, dp_file_name = ${fileName}
     WHERE id IN (${linkedRequestIds(rpLetterId)})
  `);
}

/**
 * Очистить поле «РП» связанных заявок и снять привязку rp_letter_requests
 * (заявки освобождаются для новой РП). Используется при удалении и аннулировании.
 */
export async function clearDpAndUnlink(tx: RpDb, rpLetterId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE public.payment_requests
       SET dp_number = NULL, dp_date = NULL, dp_amount = NULL,
           dp_file_key = NULL, dp_file_name = NULL
     WHERE id IN (${linkedRequestIds(rpLetterId)})
  `);
  await tx.delete(rpLetterRequests).where(eq(rpLetterRequests.rpLetterId, rpLetterId));
}

/* ------------------------------------------------------------------ */
/*  Счётчик и списки файлов РП                                         */
/* ------------------------------------------------------------------ */

/** Число файлов на письмо (вложения PayHub + служебные) для колонки-счётчика реестра. */
export async function countFilesByLetter(
  db: RpDb,
  letterIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (letterIds.length === 0) return map;
  const att = await db
    .select({ id: rpLetterAttachments.rpLetterId, c: sql<number>`count(*)::int` })
    .from(rpLetterAttachments)
    .where(inArray(rpLetterAttachments.rpLetterId, letterIds))
    .groupBy(rpLetterAttachments.rpLetterId);
  const svc = await db
    .select({ id: rpLetterServiceFiles.rpLetterId, c: sql<number>`count(*)::int` })
    .from(rpLetterServiceFiles)
    .where(inArray(rpLetterServiceFiles.rpLetterId, letterIds))
    .groupBy(rpLetterServiceFiles.rpLetterId);
  for (const r of [...att, ...svc]) map.set(r.id, (map.get(r.id) ?? 0) + Number(r.c));
  return map;
}

/** Файлы РП для модалки: вложения письма PayHub + служебные файлы. */
export async function getRpFiles(db: RpDb, rpLetterId: string): Promise<RpFilesResult> {
  const payhub = await db
    .select({
      id: rpLetterAttachments.id,
      fileKey: rpLetterAttachments.fileKey,
      fileName: rpLetterAttachments.fileName,
      mimeType: rpLetterAttachments.mimeType,
      sizeBytes: rpLetterAttachments.sizeBytes,
      fileType: rpLetterAttachments.fileType,
      payhubAttachmentId: rpLetterAttachments.payhubAttachmentId,
      createdAt: rpLetterAttachments.createdAt,
    })
    .from(rpLetterAttachments)
    .where(eq(rpLetterAttachments.rpLetterId, rpLetterId))
    .orderBy(asc(rpLetterAttachments.createdAt));
  const service = await db
    .select({
      id: rpLetterServiceFiles.id,
      fileKey: rpLetterServiceFiles.fileKey,
      fileName: rpLetterServiceFiles.fileName,
      mimeType: rpLetterServiceFiles.mimeType,
      sizeBytes: rpLetterServiceFiles.sizeBytes,
      createdAt: rpLetterServiceFiles.createdAt,
    })
    .from(rpLetterServiceFiles)
    .where(eq(rpLetterServiceFiles.rpLetterId, rpLetterId))
    .orderBy(asc(rpLetterServiceFiles.createdAt));
  return { payhub, service };
}

/** Зарегистрировать служебные файлы РП. */
export async function addServiceFiles(
  db: RpDb,
  rpLetterId: string,
  createdBy: string,
  refs: RpServiceFileRef[],
): Promise<void> {
  if (refs.length === 0) return;
  await db.insert(rpLetterServiceFiles).values(
    refs.map((r) => ({
      rpLetterId,
      createdBy,
      fileKey: r.fileKey,
      fileName: r.fileName,
      mimeType: r.mimeType ?? null,
      sizeBytes: r.sizeBytes ?? null,
    })),
  );
}

/** Удалить служебный файл РП; вернуть его file_key для очистки S3 (null — не найден). */
export async function deleteServiceFile(
  db: RpDb,
  rpLetterId: string,
  fileId: string,
): Promise<string | null> {
  const [row] = await db
    .delete(rpLetterServiceFiles)
    .where(
      and(eq(rpLetterServiceFiles.id, fileId), eq(rpLetterServiceFiles.rpLetterId, rpLetterId)),
    )
    .returning({ fileKey: rpLetterServiceFiles.fileKey });
  return row?.fileKey ?? null;
}

/** Ключи служебных файлов РП (для best-effort очистки S3 при удалении РП). */
export async function listServiceFileKeys(db: RpDb, rpLetterId: string): Promise<string[]> {
  const rows = await db
    .select({ fileKey: rpLetterServiceFiles.fileKey })
    .from(rpLetterServiceFiles)
    .where(eq(rpLetterServiceFiles.rpLetterId, rpLetterId));
  return rows.map((r) => r.fileKey);
}

/* ------------------------------------------------------------------ */
/*  Прикрепление счетов заявок к РП как служебные файлы (0011)         */
/* ------------------------------------------------------------------ */

/** Активные счета выбранных заявок, сгруппированные по заявке (для окна выбора). */
export async function listInvoiceCandidates(
  db: RpDb,
  paymentRequestIds: string[],
  siteIds: string[] | null,
): Promise<RpInvoiceCandidateGroup[]> {
  if (paymentRequestIds.length === 0) return [];
  if (siteIds !== null && siteIds.length === 0) return [];
  const rows = await db
    .select({
      requestId: paymentRequests.id,
      requestNumber: paymentRequests.requestNumber,
      fileId: paymentRequestFiles.id,
      fileName: paymentRequestFiles.fileName,
      mimeType: paymentRequestFiles.mimeType,
      sizeBytes: paymentRequestFiles.fileSize,
    })
    .from(paymentRequestFiles)
    .innerJoin(paymentRequests, eq(paymentRequests.id, paymentRequestFiles.paymentRequestId))
    .where(
      and(
        inArray(paymentRequestFiles.paymentRequestId, paymentRequestIds),
        eq(paymentRequestFiles.documentTypeId, INVOICE_DOC_TYPE_ID),
        eq(paymentRequestFiles.isRejected, false),
        siteIds === null ? undefined : inArray(paymentRequests.siteId, siteIds),
      ),
    )
    .orderBy(asc(paymentRequests.requestNumber), asc(paymentRequestFiles.createdAt));

  // Группировка по заявке с сохранением порядка появления.
  const groups: RpInvoiceCandidateGroup[] = [];
  const byId = new Map<string, RpInvoiceCandidateGroup>();
  for (const r of rows) {
    let g = byId.get(r.requestId);
    if (!g) {
      g = { requestId: r.requestId, requestNumber: r.requestNumber, files: [] };
      byId.set(r.requestId, g);
      groups.push(g);
    }
    g.files.push({
      id: r.fileId,
      fileName: r.fileName,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
    });
  }
  return groups;
}

/**
 * Ре-проверка: из fileIds оставить только активные счета, чьи заявки входят в эту РП.
 * Возвращает метаданные для копирования в S3.
 */
export async function getAttachableInvoiceFiles(
  db: RpDb,
  rpLetterId: string,
  fileIds: string[],
): Promise<RpInvoiceFileMeta[]> {
  if (fileIds.length === 0) return [];
  const rows = await db
    .select({
      id: paymentRequestFiles.id,
      fileKey: paymentRequestFiles.fileKey,
      fileName: paymentRequestFiles.fileName,
      mimeType: paymentRequestFiles.mimeType,
      sizeBytes: paymentRequestFiles.fileSize,
    })
    .from(paymentRequestFiles)
    .innerJoin(
      rpLetterRequests,
      eq(rpLetterRequests.paymentRequestId, paymentRequestFiles.paymentRequestId),
    )
    .where(
      and(
        eq(rpLetterRequests.rpLetterId, rpLetterId),
        inArray(paymentRequestFiles.id, fileIds),
        eq(paymentRequestFiles.documentTypeId, INVOICE_DOC_TYPE_ID),
        eq(paymentRequestFiles.isRejected, false),
      ),
    );
  return rows;
}

/** Какие из ключей уже зарегистрированы служебными файлами этой РП (для дедупа copy). */
export async function getExistingServiceKeys(
  db: RpDb,
  rpLetterId: string,
  fileKeys: string[],
): Promise<string[]> {
  if (fileKeys.length === 0) return [];
  const rows = await db
    .select({ fileKey: rpLetterServiceFiles.fileKey })
    .from(rpLetterServiceFiles)
    .where(
      and(
        eq(rpLetterServiceFiles.rpLetterId, rpLetterId),
        inArray(rpLetterServiceFiles.fileKey, fileKeys),
      ),
    );
  return rows.map((r) => r.fileKey);
}

/**
 * Идемпотентная регистрация служебных файлов (уже скопированных в S3): под блокировкой
 * строки РП вставляет только отсутствующие по file_key; возвращает число добавленных.
 */
export async function addServiceFilesIdempotent(
  db: RpDb,
  rpLetterId: string,
  createdBy: string,
  refs: RpServiceFileRef[],
): Promise<number> {
  if (refs.length === 0) return 0;
  return db.transaction(async (tx) => {
    // Блокировка строки РП — сериализация конкурентных привязок к одной РП.
    await tx
      .select({ id: rpLetters.id })
      .from(rpLetters)
      .where(eq(rpLetters.id, rpLetterId))
      .for('update');
    const keys = refs.map((r) => r.fileKey);
    const existing = await tx
      .select({ fileKey: rpLetterServiceFiles.fileKey })
      .from(rpLetterServiceFiles)
      .where(
        and(
          eq(rpLetterServiceFiles.rpLetterId, rpLetterId),
          inArray(rpLetterServiceFiles.fileKey, keys),
        ),
      );
    const existingSet = new Set(existing.map((e) => e.fileKey));
    const toInsert = refs.filter((r) => !existingSet.has(r.fileKey));
    if (toInsert.length > 0) {
      await tx.insert(rpLetterServiceFiles).values(
        toInsert.map((r) => ({
          rpLetterId,
          createdBy,
          fileKey: r.fileKey,
          fileName: r.fileName,
          mimeType: r.mimeType ?? null,
          sizeBytes: r.sizeBytes ?? null,
        })),
      );
    }
    return toInsert.length;
  });
}
