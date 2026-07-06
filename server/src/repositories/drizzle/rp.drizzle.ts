/**
 * DrizzleRpRepository — реестр распределительных писем (РП). Введён миграцией 0006.
 * Только Drizzle (без Supabase).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  rpLetters,
  rpLetterRequests,
  rpLetterDocuments,
  rpLetterAttachments,
  rpLetterServiceFiles,
  paymentRequests,
  constructionSites,
} from '../../db/schema/index.js';
import { ValidationError, NotFoundError } from '../types.js';
import type { RpLetterPayload } from '../../db/schema/rp.js';
import type {
  RpRepository,
  RpRegistryRow,
  RpDocumentsResult,
  CreateRpInput,
  RpLetterAttachmentRef,
  RpLetterSyncContext,
  RpLetterSyncStatus,
  RpLetterSyncedResult,
  RpMutationContext,
  RpFilesResult,
  RpServiceFileRef,
  RpInvoiceCandidateGroup,
  RpInvoiceFileMeta,
} from '../rp.repository.js';
import {
  propagateDpNumberDate,
  propagateDpFile,
  clearDpAndUnlink,
  getRpFiles as getRpFilesQuery,
  addServiceFiles as addServiceFilesQuery,
  deleteServiceFile as deleteServiceFileQuery,
  listServiceFileKeys,
  listInvoiceCandidates as listInvoiceCandidatesQuery,
  getAttachableInvoiceFiles as getAttachableInvoiceFilesQuery,
  getExistingServiceKeys as getExistingServiceKeysQuery,
  addServiceFilesIdempotent as addServiceFilesIdempotentQuery,
} from './rp-files.drizzle.js';
import {
  computePaymentStatus,
  listRegistry as listRegistryQuery,
  getDocuments as getDocumentsQuery,
} from './rp-registry.drizzle.js';

type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleRpRepository implements RpRepository {
  constructor(private readonly db: Db) {}

  listRegistry(siteIds: string[] | null): Promise<RpRegistryRow[]> {
    return listRegistryQuery(this.db, siteIds);
  }

  getDocuments(
    supplierId: string,
    counterpartyId: string,
    siteId: string,
  ): Promise<RpDocumentsResult> {
    return getDocumentsQuery(this.db, supplierId, counterpartyId, siteId);
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
      // Файл типа «РП» (скан чистовика) — не более одного на письмо (плюс частичный
      // unique-индекс на уровне БД). Проверка под FOR UPDATE — гонки исключены.
      const newRpFiles = newRefs.filter((r) => r.fileType === 'rp');
      if (newRpFiles.length > 1) {
        throw new ValidationError('Можно приложить только один файл типа «РП»');
      }
      if (newRpFiles.length === 1) {
        const existingRp = await tx
          .select({ id: rpLetterAttachments.id })
          .from(rpLetterAttachments)
          .where(
            and(
              eq(rpLetterAttachments.rpLetterId, rpLetterId),
              eq(rpLetterAttachments.fileType, 'rp'),
            ),
          )
          .limit(1);
        if (existingRp.length > 0) {
          throw new ValidationError('У письма уже есть файл типа «РП»');
        }
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
            fileType: r.fileType ?? 'other',
          })),
        )
        .onConflictDoNothing({
          target: [rpLetterAttachments.rpLetterId, rpLetterAttachments.fileKey],
        });

      // Файл типа «РП» → дублируем в поле «РП» связанных заявок (dp_file_key).
      if (newRpFiles.length === 1) {
        await propagateDpFile(tx, rpLetterId, newRpFiles[0]!.fileKey, newRpFiles[0]!.fileName);
      }
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
    await this.db.transaction(async (tx) => {
      await tx
        .update(rpLetters)
        .set({
          payhubLetterId: result.payhubLetterId,
          payhubLetterRegNumber: result.payhubLetterRegNumber,
          payhubLetterUrl: result.payhubLetterUrl,
          payhubLetterStatusUpdatedAt: sql`now()`,
        })
        .where(eq(rpLetters.id, rpLetterId));
      // Рег.номер и дату письма PayHub подтягиваем в поле «РП» связанных заявок.
      // Только при наличии рег.номера (иначе «пустой РП» — дозаполнит повтор/воркер).
      if (result.payhubLetterRegNumber) {
        await propagateDpNumberDate(
          tx,
          rpLetterId,
          result.payhubLetterRegNumber,
          result.payhubLetterDate,
        );
      }
    });
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

  /* ------------------------------------------------------------------ */
  /*  Действия из реестра (удаление / аннулирование / редактирование)    */
  /* ------------------------------------------------------------------ */

  async getRpMutationContext(id: string): Promise<RpMutationContext | null> {
    const [row] = await this.db
      .select({
        id: rpLetters.id,
        status: rpLetters.status,
        payhubLetterId: rpLetters.payhubLetterId,
      })
      .from(rpLetters)
      .where(eq(rpLetters.id, id))
      .limit(1);
    if (!row) return null;

    // Платёжный статус — из связанных заявок (как в listRegistry).
    const reqs = await this.db
      .select({
        invoiceAmount: paymentRequests.invoiceAmount,
        totalPaid: paymentRequests.totalPaid,
      })
      .from(rpLetterRequests)
      .innerJoin(paymentRequests, eq(paymentRequests.id, rpLetterRequests.paymentRequestId))
      .where(eq(rpLetterRequests.rpLetterId, id));

    const atts = await this.db
      .select({ fileKey: rpLetterAttachments.fileKey })
      .from(rpLetterAttachments)
      .where(eq(rpLetterAttachments.rpLetterId, id));

    return {
      id: row.id,
      status: row.status,
      paymentStatus: computePaymentStatus(reqs),
      payhubLetterId: row.payhubLetterId,
      attachmentFileKeys: atts.map((a) => a.fileKey),
      serviceFileKeys: await listServiceFileKeys(this.db, id),
    };
  }

  async updateLetterText(
    id: string,
    letterDate: string | null,
    payload: RpLetterPayload,
  ): Promise<void> {
    const res = await this.db
      .update(rpLetters)
      .set({ letterDate: letterDate ?? null, payhubLetterPayload: payload })
      .where(eq(rpLetters.id, id))
      .returning({ id: rpLetters.id });
    if (res.length === 0) throw new NotFoundError('РП', id);
  }

  async annulRp(id: string): Promise<void> {
    // Полная очистка полей письма PayHub и payload: строка перестаёт быть кандидатом
    // sweep (payhub_letter_status = NULL) и syncRpLetter (пустой payload -> skipped).
    // Заявки освобождаем: очищаем поле «РП» и снимаем привязку (как при удалении).
    await this.db.transaction(async (tx) => {
      const res = await tx
        .update(rpLetters)
        .set({
          status: 'annulled',
          payhubLetterId: null,
          payhubLetterRegNumber: null,
          payhubLetterUrl: null,
          payhubLetterStatus: null,
          payhubLetterError: null,
          payhubLetterPayload: null,
          payhubLetterStatusUpdatedAt: sql`now()`,
        })
        .where(eq(rpLetters.id, id))
        .returning({ id: rpLetters.id });
      if (res.length === 0) throw new NotFoundError('РП', id);
      await clearDpAndUnlink(tx, id);
    });
  }

  async deleteRp(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: rpLetters.id })
        .from(rpLetters)
        .where(eq(rpLetters.id, id))
        .for('update')
        .limit(1);
      if (!row) throw new NotFoundError('РП', id);
      // Очистка поля «РП» связанных заявок + снятие привязки (rp_letter_requests).
      await clearDpAndUnlink(tx, id);
      // Явное удаление связей (не полагаемся на каскады во всех дочерних таблицах).
      await tx.delete(rpLetterDocuments).where(eq(rpLetterDocuments.rpLetterId, id));
      await tx.delete(rpLetterAttachments).where(eq(rpLetterAttachments.rpLetterId, id));
      await tx.delete(rpLetterServiceFiles).where(eq(rpLetterServiceFiles.rpLetterId, id));
      await tx.delete(rpLetters).where(eq(rpLetters.id, id));
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Файлы РП (0010): вложения письма PayHub + служебные файлы          */
  /* ------------------------------------------------------------------ */

  getRpFiles(id: string): Promise<RpFilesResult> {
    return getRpFilesQuery(this.db, id);
  }

  addServiceFiles(id: string, createdBy: string, refs: RpServiceFileRef[]): Promise<void> {
    return addServiceFilesQuery(this.db, id, createdBy, refs);
  }

  deleteServiceFile(id: string, fileId: string): Promise<string | null> {
    return deleteServiceFileQuery(this.db, id, fileId);
  }

  /* ------------------------------------------------------------------ */
  /*  Прикрепление счетов заявок к РП (0011)                            */
  /* ------------------------------------------------------------------ */

  listInvoiceCandidates(
    paymentRequestIds: string[],
    siteIds: string[] | null,
  ): Promise<RpInvoiceCandidateGroup[]> {
    return listInvoiceCandidatesQuery(this.db, paymentRequestIds, siteIds);
  }

  getAttachableInvoiceFiles(rpLetterId: string, fileIds: string[]): Promise<RpInvoiceFileMeta[]> {
    return getAttachableInvoiceFilesQuery(this.db, rpLetterId, fileIds);
  }

  getExistingServiceKeys(rpLetterId: string, fileKeys: string[]): Promise<string[]> {
    return getExistingServiceKeysQuery(this.db, rpLetterId, fileKeys);
  }

  addServiceFilesIdempotent(
    rpLetterId: string,
    createdBy: string,
    refs: RpServiceFileRef[],
  ): Promise<number> {
    return addServiceFilesIdempotentQuery(this.db, rpLetterId, createdBy, refs);
  }
}
