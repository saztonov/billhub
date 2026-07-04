/**
 * RpRepository — доступ к реестру распределительных писем (РП).
 * Реализация ТОЛЬКО на Drizzle (проект ушёл от Supabase; в новых решениях его нет).
 * Введён миграцией 0006, интеграция с письмами PayHub — миграцией 0008.
 */
import type { RpLetterPayload } from '../db/schema/rp.js';

/** Статус оплаты РП, вычисляемый из связанных заявок. */
export type RpPaymentStatus = 'paid' | 'partial' | 'unpaid';

/**
 * Статус синхронизации письма PayHub (NULL в БД => письмо не запрашивалось, старые РП).
 * uploading — клиент догружает файлы; pending — в очереди/выполняется;
 * waiting_config — ожидание конфигурации (не ошибка); synced — готово; failed — попытки исчерпаны.
 */
export type RpLetterSyncStatus = 'uploading' | 'pending' | 'waiting_config' | 'synced' | 'failed';

/** Ссылка на заявку в записи реестра. */
export interface RpRequestRef {
  id: string;
  requestNumber: string;
}

/** Строка реестра РП (для таблицы «Реестр РП»). */
export interface RpRegistryRow {
  id: string;
  number: string;
  letterDate: string | null;
  createdAt: string;
  status: string;
  totalAmount: number;
  description: string;
  supplierId: string;
  supplierName: string;
  supplierInn: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyInn: string;
  siteId: string;
  siteName: string;
  createdBy: string;
  requests: RpRequestRef[];
  paymentStatus: RpPaymentStatus;
  // Письмо PayHub (0008)
  payhubLetterId: string | null;
  payhubLetterRegNumber: string | null;
  payhubLetterUrl: string | null;
  payhubLetterStatus: RpLetterSyncStatus | null;
  payhubLetterError: string | null;
  /** Снимок полей письма (для префилла редактирования из реестра). */
  payhubLetterPayload: RpLetterPayload | null;
}

/** Документ договора для модалки создания РП. */
export interface RpContractDoc {
  id: string;
  fileKey: string;
  fileName: string;
  mimeType: string | null;
  contractNumber: string | null;
  contractDate: string | null;
  isSignedContract: boolean;
}

/** Учредительный документ поставщика для модалки. */
export interface RpFoundingDoc {
  id: string;
  fileKey: string;
  fileName: string;
  mimeType: string | null;
  typeName: string;
}

/** Документы для модалки (связка Поставщик+Подрядчик+Объект). */
export interface RpDocumentsResult {
  contract: RpContractDoc[];
  founding: RpFoundingDoc[];
}

/** Снимок выбранного документа, сохраняемый в составе РП. */
export interface RpDocumentRef {
  source: 'contract' | 'founding';
  fileKey: string;
  fileName: string;
  mimeType?: string | null;
  contractNumber?: string | null;
  contractDate?: string | null;
}

/** Вход создания РП. */
export interface CreateRpInput {
  supplierId: string;
  counterpartyId: string;
  siteId: string;
  paymentRequestIds: string[];
  documents: RpDocumentRef[];
  letterDate?: string | null;
  createdBy: string;
  /** Снимок полей формы письма PayHub; null/undefined — письмо не запрашивается. */
  letter?: RpLetterPayload | null;
  /**
   * Начальный статус синхронизации при наличии letter:
   * uploading — клиент будет догружать файлы (finalize отдельным запросом);
   * pending — файлов нет, задача ставится в очередь сразу.
   */
  letterInitialStatus?: 'uploading' | 'pending';
}

/** Файл письма, зарегистрированный за РП (лежит в billhub S3). */
export interface RpLetterAttachmentRef {
  fileKey: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

/** Вложение письма из БД (для воркера). */
export interface RpLetterAttachmentRow {
  id: string;
  fileKey: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  payhubAttachmentId: string | null;
}

/** Контекст синхронизации письма для воркера. */
export interface RpLetterSyncContext {
  id: string;
  number: string;
  letterDate: string | null;
  payload: RpLetterPayload | null;
  payhubLetterId: string | null;
  payhubLetterUrl: string | null;
  payhubLetterStatus: RpLetterSyncStatus | null;
  /** Сопоставление объекта строительства с PayHub */
  sitePayhubProjectId: number | null;
  sitePayhubContractorId: string | null;
  attachments: RpLetterAttachmentRow[];
}

/** Результат успешной синхронизации письма. */
export interface RpLetterSyncedResult {
  payhubLetterId: string;
  payhubLetterRegNumber: string | null;
  payhubLetterUrl: string | null;
}

/** Контекст для действий из реестра (удаление/аннулирование/редактирование). */
export interface RpMutationContext {
  id: string;
  /** Локальный статус РП (draft/annulled/...). */
  status: string;
  /** Платёжный статус, вычисленный из связанных заявок. */
  paymentStatus: RpPaymentStatus;
  /** id письма PayHub (для удаления письма перед изменением РП). */
  payhubLetterId: string | null;
  /** Ключи файлов вложений в billhub S3 (для best-effort очистки при удалении). */
  attachmentFileKeys: string[];
}

export interface RpRepository {
  /** Реестр РП; siteIds=null => все объекты (admin/allSites), иначе фильтр по объектам. */
  listRegistry(siteIds: string[] | null): Promise<RpRegistryRow[]>;
  /** Документы (договор + учредительные поставщика) для связки. */
  getDocuments(
    supplierId: string,
    counterpartyId: string,
    siteId: string,
  ): Promise<RpDocumentsResult>;
  /** Создать РП из согласованных заявок одной связки. Возвращает созданную строку реестра. */
  create(input: CreateRpInput): Promise<RpRegistryRow>;
  /** Сменить статус РП. */
  updateStatus(id: string, status: string): Promise<void>;
  /** siteId объекта РП (для сверки со scope на write-хендлерах); null — РП не найдена. */
  getRpSiteId(id: string): Promise<string | null>;

  /* ---------- Письмо PayHub (0008) ---------- */

  /** Зарегистрировать файлы письма за РП (только в статусе uploading). */
  addLetterAttachments(rpLetterId: string, refs: RpLetterAttachmentRef[]): Promise<void>;
  /**
   * Перевести письмо в pending (finalize / ручной повтор).
   * Допустимо из uploading/failed/waiting_config/pending (идемпотентно); из synced — ошибка.
   */
  finalizeLetter(rpLetterId: string): Promise<void>;
  /** Контекст синхронизации для воркера (включая сопоставление объекта и вложения). */
  getLetterSyncContext(rpLetterId: string): Promise<RpLetterSyncContext | null>;
  /** Инкремент счётчика попыток синхронизации (вызывается в начале задачи). */
  recordLetterSyncAttempt(rpLetterId: string): Promise<void>;
  /** Установить статус синхронизации (waiting_config/failed/pending) с текстом ошибки. */
  setLetterSyncStatus(
    rpLetterId: string,
    status: RpLetterSyncStatus,
    error?: string | null,
  ): Promise<void>;
  /** Привязать письмо (id/рег.номер/ссылка) БЕЗ смены статуса — сразу после создания в PayHub. */
  setLetterLinked(rpLetterId: string, result: RpLetterSyncedResult): Promise<void>;
  /** Записать результат успешной синхронизации (id/рег.номер/ссылка) и статус synced. */
  setLetterSynced(rpLetterId: string, result: RpLetterSyncedResult): Promise<void>;
  /** Проставить id вложения PayHub после успешной дозагрузки. */
  setAttachmentPayhubId(attachmentId: string, payhubAttachmentId: string): Promise<void>;
  /** id РП со статусами pending/waiting_config для sweep-задачи (переустановка в очередь). */
  listLetterSyncCandidates(statuses: RpLetterSyncStatus[]): Promise<string[]>;

  /* ---------- Действия из реестра ---------- */

  /** Контекст РП для действий из реестра (статус, платёж, id письма, ключи вложений). */
  getRpMutationContext(id: string): Promise<RpMutationContext | null>;
  /** Обновить текст письма (дата + снимок формы) без обращения к PayHub. */
  updateLetterText(id: string, letterDate: string | null, payload: RpLetterPayload): Promise<void>;
  /**
   * Аннулировать РП: статус annulled + очистка всех полей письма PayHub и payload
   * (чтобы sweep не пересоздал письмо). Письмо в PayHub удаляет вызывающий роут ДО этого.
   */
  annulRp(id: string): Promise<void>;
  /** Удалить РП со всеми связями (заявки/документы/вложения) в транзакции. */
  deleteRp(id: string): Promise<void>;
}
