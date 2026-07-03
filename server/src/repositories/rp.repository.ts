/**
 * RpRepository — доступ к реестру распределительных писем (РП).
 * Реализация ТОЛЬКО на Drizzle (проект ушёл от Supabase; в новых решениях его нет).
 * Введён миграцией 0006.
 */

/** Статус оплаты РП, вычисляемый из связанных заявок. */
export type RpPaymentStatus = 'paid' | 'partial' | 'unpaid';

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
  requests: RpRequestRef[];
  paymentStatus: RpPaymentStatus;
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
}
