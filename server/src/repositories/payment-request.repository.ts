/**
 * PaymentRequestRepository — заявки на оплату (payment-requests + extra).
 * Strangler Fig: Supabase (rollback) и Drizzle. Записи — в db.transaction().
 *
 * ВАЖНО (миграция 004): финальность заявки определяется СТАТУСОМ, а не флагом withdrawn_at.
 * resubmit() обязан очищать withdrawn_at + withdrawal_comment (путь реактивации).
 */
import type {
  UpdatePaymentRequestBody,
  ResubmitBody,
  DpDataBody,
  AddPaymentRequestFileBody,
} from '../schemas/payment-request.js';

/** Плоская строка заявки (все колонки + join-поля), как отдаёт flattenPaymentRequest. */
export type PaymentRequestRow = Record<string, unknown>;

/** Фильтр списка заявок (auth-решения — counterpartyId/siteIds — принимает роут). */
export interface PaymentRequestListFilter {
  showDeleted?: boolean;
  /** Изоляция контрагента: жёсткое ограничение по counterparty_id. */
  counterpartyId?: string;
  /** Ограничение по объектам пользователя; пустой массив ⇒ пустой результат. */
  siteIds?: string[];
  supplierId?: string;
  siteId?: string;
  statusId?: string;
  costTypeId?: string;
  dateFrom?: string;
  /** Дата (YYYY-MM-DD); репозиторий добавляет конец дня. */
  dateTo?: string;
  search?: string;
  pagination?: { page: number; pageSize: number };
}

/** Тип заявки: обычный подрядчик / работа подрядчика / своя закупка (0012) */
export type PaymentRequestType = 'contractor' | 'contractor_work' | 'own_purchase';

export interface CreatePaymentRequestInput {
  /** Тип заявки; для contractor_work/own_purchase заявка создаётся сразу «Согласовано». */
  requestType: PaymentRequestType;
  counterpartyId: string;
  siteId: string;
  /** null для типов без срока поставки (contractor_work/own_purchase). */
  deliveryDays?: number | null;
  deliveryDaysType: string;
  /** null для типов без условий отгрузки (contractor_work). */
  shippingConditionId?: string | null;
  comment?: string | null;
  totalFiles: number;
  invoiceAmount?: number | null;
  supplierId?: string | null;
  createdBy: string;
}

export interface PaymentRequestRepository {
  /** Список заявок с join-полями (flatten). */
  list(filter: PaymentRequestListFilter): Promise<PaymentRequestRow[]>;

  /** Объекты пользователя (для site-scoping в роуте). */
  getUserSiteIds(userId: string): Promise<string[]>;

  /** Одна заявка с join-полями; null если не найдена (роут → 404). Без is_deleted-фильтра. */
  getById(id: string): Promise<PaymentRequestRow | null>;

  /** counterparty_id заявки (для проверки изоляции в роуте, без зависимости от casing). null если нет. */
  getOwnerCounterpartyId(id: string): Promise<string | null>;

  /** Создать заявку (status approv_shtab, stage 1, approval_decisions, stage_history). Транзакция. */
  create(input: CreatePaymentRequestInput): Promise<{ requestId: string; requestNumber: string }>;

  /**
   * Обновить заявку с диффом полей и audit-логом (payment_request_logs).
   * Бросает NotFoundError, ForbiddenError (если actingCounterpartyId задан и не совпадает).
   */
  update(
    id: string,
    patch: UpdatePaymentRequestBody,
    ctx: { userId: string; actingCounterpartyId?: string | null },
  ): Promise<void>;

  /** Мягкое удаление (is_deleted, deleted_at). */
  softDelete(id: string): Promise<void>;

  /** Отзыв: статус withdrawn + withdrawn_at + comment. */
  withdraw(id: string, comment?: string | null): Promise<void>;

  /**
   * Повторная отправка: сброс на stage 1 Штаб, очистка withdrawn_at, пересоздание pending-решения.
   * actor (опц.) — серверная авторизация: владелец-контрагент своей заявки либо admin, и только из
   * статусов «отклонена»/«отозвана» (защита от сброса чужой/согласованной заявки на этап 1).
   */
  resubmit(
    id: string,
    input: ResubmitBody,
    userId: string,
    actor?: { counterpartyId?: string | null; isAdmin: boolean },
  ): Promise<void>;

  /** Установить статус (verbatim). */
  setStatus(id: string, statusId: string): Promise<void>;

  /** Сохранить данные РП/ДП. */
  setDpData(id: string, dp: DpDataBody): Promise<void>;

  /** Входит ли заявка в РП (rp_letter_requests) — поле «РП» заполняется автоматически (0010). */
  isInRpLetter(id: string): Promise<boolean>;

  /**
   * Является ли fileKey файлом «РП» (dp_file_key) заявки данного контрагента —
   * для доступа counterparty_user к файлу письма РП из папки rp-letters/… (0010).
   */
  isDpFileOfCounterparty(fileKey: string, counterpartyId: string): Promise<boolean>;

  /** Файлы заявки с join-полями (тип документа + загрузивший). */
  listFiles(paymentRequestId: string): Promise<PaymentRequestRow[]>;

  /** Добавить файл + обновить счётчики (uploaded_files/total_files). Транзакция. */
  addFile(paymentRequestId: string, file: AddPaymentRequestFileBody): Promise<void>;

  /** Текущий флаг отклонения файла (null если файл не найден). */
  getFileRejection(fileId: string): Promise<boolean | null>;

  /** Установить флаг отклонения файла (rejectedBy при isRejected=true, иначе очистка). */
  setFileRejection(fileId: string, isRejected: boolean, rejectedBy: string | null): Promise<void>;

  /** Номер заявки (для OCR-очереди); null если не найдена. */
  getRequestNumber(id: string): Promise<string | null>;
}
