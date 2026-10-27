/**
 * Создание РП внутри переданной транзакции: проверки связки/статуса заявок, сквозной номер,
 * строки rp_letters / rp_letter_requests / rp_letter_documents.
 * Вынесено из rp.drizzle.ts (лимит 600 строк на файл) — общая точка для ручного создания
 * (POST /api/rp, letter-stage1) и автосоздания при согласовании на этапе «РП» (rp-auto).
 */
import { inArray, sql } from 'drizzle-orm';
import {
  rpLetters,
  rpLetterRequests,
  rpLetterDocuments,
  paymentRequests,
} from '../../db/schema/index.js';
import { ValidationError } from '../types.js';
import type { CreateRpInput } from '../rp.repository.js';
import type { RpDb } from './rp-files.drizzle.js';

/** Создаёт РП в транзакции tx и возвращает её id. Бросает ValidationError при нарушении правил. */
export async function insertRpTx(tx: RpDb, input: CreateRpInput): Promise<string> {
  const { supplierId, counterpartyId, siteId, paymentRequestIds, documents, createdBy } = input;

  if (paymentRequestIds.length === 0) {
    throw new ValidationError('Не выбрано ни одной заявки для РП');
  }

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
      dpNumber: paymentRequests.dpNumber,
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
    // Заявка уже имеет РП (заполнено поле «РП») — в новую РП её включать нельзя.
    if (r.dpNumber) {
      throw new ValidationError('Заявка уже включена в РП — сначала удалите её из текущей РП');
    }
    if (r.supplierId !== supplierId || r.counterpartyId !== counterpartyId || r.siteId !== siteId) {
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
      invoiceNumber: input.invoiceNumber ?? null,
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
}
