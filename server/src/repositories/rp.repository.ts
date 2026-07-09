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
  /** Дата отправки письма (0013): ручной ввод из реестра; null — не заполнена. */
  sentDate: string | null;
  status: string;
  totalAmount: number;
  description: string;
  // Поставщик необязателен: РП по СМР создаётся без поставщика (0018).
  supplierId: string | null;
  supplierName: string | null;
  supplierInn: string | null;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyInn: string;
  siteId: string;
  siteName: string;
  createdBy: string;
  /** ФИО автора РП (users.full_name); null при пустом ФИО или отсутствии пользователя. */
  createdByName: string | null;
  /** Номер счёта (0011): ручной ввод в форме создания РП; в реестре справа от суммы. */
  invoiceNumber: string | null;
  requests: RpRequestRef[];
  paymentStatus: RpPaymentStatus;
  /** Дата последнего исполненного платежа; заполняется только при paymentStatus='paid'. */
  paidAt: string | null;
  // Письмо PayHub (0008)
  payhubLetterId: string | null;
  payhubLetterRegNumber: string | null;
  payhubLetterUrl: string | null;
  payhubLetterStatus: RpLetterSyncStatus | null;
  payhubLetterError: string | null;
  /** Снимок полей письма (для префилла редактирования из реестра). */
  payhubLetterPayload: RpLetterPayload | null;
  /** Всего файлов РП (вложения письма PayHub + служебные файлы) — для счётчика в реестре (0010). */
  filesCount: number;
  /** Есть вложение письма типа 'rp' (скан чистовика) — зелёная скрепка в реестре. */
  hasRpFile: boolean;
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
  /** null — РП по СМР без поставщика (0018). */
  supplierId: string | null;
  counterpartyId: string;
  siteId: string;
  paymentRequestIds: string[];
  documents: RpDocumentRef[];
  letterDate?: string | null;
  /** Номер счёта (0011): trim + пустая строка -> null выполняет вызывающий роут. */
  invoiceNumber?: string | null;
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
  /** 'rp' — скан чистовика письма (идёт в поле «РП» заявок); 'other' (по умолчанию) — прочие (0010). */
  fileType?: 'rp' | 'other';
}

/** Служебный файл РП (billhub S3, в PayHub не уходит) — вход регистрации (0010). */
export interface RpServiceFileRef {
  fileKey: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

/** Файл-счёт заявки — кандидат для прикрепления к РП (0011). */
export interface RpInvoiceCandidateFile {
  id: string;
  /** Ключ S3 (для просмотра файла в окне выбора счетов). */
  fileKey: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

/** Группа кандидатов по заявке для окна выбора счетов (0011). */
export interface RpInvoiceCandidateGroup {
  requestId: string;
  requestNumber: string;
  files: RpInvoiceCandidateFile[];
}

/** Метаданные файла-счёта, прошедшего серверную ре-проверку при привязке к РП (0011). */
export interface RpInvoiceFileMeta {
  id: string;
  fileKey: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

/** Вложение письма PayHub для модалки «Файлы РП» (0010). */
export interface RpAttachmentView {
  id: string;
  fileKey: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  fileType: string;
  payhubAttachmentId: string | null;
  createdAt: string;
}

/** Служебный файл РП для модалки «Файлы РП» (0010). */
export interface RpServiceFileView {
  id: string;
  fileKey: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

/** Файлы РП: вложения письма PayHub + служебные файлы (0010). */
export interface RpFilesResult {
  payhub: RpAttachmentView[];
  service: RpServiceFileView[];
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
  /**
   * Фактическая дата письма PayHub (letter_date из ответа). Вместе с рег.номером
   * подтягивается в поле «РП» связанных заявок при привязке письма (setLetterLinked).
   */
  payhubLetterDate: string | null;
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
  /** Ключи служебных файлов РП в billhub S3 (для best-effort очистки при удалении) (0010). */
  serviceFileKeys: string[];
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
   * Дописать вложения к уже оформленному письму (из редактирования, 0013).
   * Разрешено для synced/pending/failed/waiting_config/uploading; запрещено для
   * аннулированной РП и РП без оформленного письма (payhubLetterStatus=null / нет payload).
   * Сохраняет лимит 20, «не более одного файла типа РП», идемпотентность по (rp_letter_id, file_key).
   * Возвращает shouldEnqueue=true, если письмо уже создано и нужно поставить задачу синхронизации.
   */
  appendLetterAttachments(
    rpLetterId: string,
    refs: RpLetterAttachmentRef[],
  ): Promise<{ shouldEnqueue: boolean }>;
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
  /** Обновить дату отправки письма (0013); null — очистить. */
  updateSentDate(id: string, sentDate: string | null): Promise<void>;
  /**
   * Аннулировать РП: статус annulled + очистка всех полей письма PayHub и payload,
   * очистка поля «РП» связанных заявок и снятие привязки (заявки освобождаются).
   * Письмо в PayHub удаляет вызывающий роут ДО этого.
   */
  annulRp(id: string): Promise<void>;
  /** Удалить РП со всеми связями (заявки/документы/вложения/служебные файлы) в транзакции. */
  deleteRp(id: string): Promise<void>;

  /* ---------- Файлы РП (0010) ---------- */

  /** Файлы РП для модалки: вложения письма PayHub + служебные файлы. */
  getRpFiles(id: string): Promise<RpFilesResult>;
  /** Зарегистрировать служебные файлы РП (уже загружены в billhub S3). */
  addServiceFiles(id: string, createdBy: string, refs: RpServiceFileRef[]): Promise<void>;
  /** Удалить служебный файл РП; возвращает его file_key для очистки S3 (null — не найден). */
  deleteServiceFile(id: string, fileId: string): Promise<string | null>;

  /* ---------- Прикрепление счетов заявок к РП (0011) ---------- */

  /**
   * Активные счета (тип «Счёт», не зачёркнутые) выбранных заявок, сгруппированные по заявке.
   * siteIds=null => без ограничения объектов; иначе только заявки объектов из scope.
   */
  listInvoiceCandidates(
    paymentRequestIds: string[],
    siteIds: string[] | null,
  ): Promise<RpInvoiceCandidateGroup[]>;
  /**
   * Ре-проверка на сервере: из fileIds оставить только активные счета, чьи заявки
   * входят в эту РП (rp_letter_requests). Возвращает метаданные для копирования в S3.
   */
  getAttachableInvoiceFiles(rpLetterId: string, fileIds: string[]): Promise<RpInvoiceFileMeta[]>;
  /** Какие из ключей уже зарегистрированы служебными файлами этой РП (для дедупа copy). */
  getExistingServiceKeys(rpLetterId: string, fileKeys: string[]): Promise<string[]>;
  /**
   * Идемпотентная регистрация служебных файлов (уже скопированных в S3): под блокировкой
   * строки РП вставляет только отсутствующие по file_key; возвращает число добавленных.
   */
  addServiceFilesIdempotent(
    rpLetterId: string,
    createdBy: string,
    refs: RpServiceFileRef[],
  ): Promise<number>;
}
