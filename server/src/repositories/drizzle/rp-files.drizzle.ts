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
  rpLetterAttachments,
  rpLetterServiceFiles,
  rpLetterRequests,
} from '../../db/schema/index.js';
import type { RpFilesResult, RpServiceFileRef } from '../rp.repository.js';

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
