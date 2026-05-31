/**
 * Repository-интерфейс домена «materials» (распознанные материалы счетов).
 */
export type Row = Record<string, unknown>;

export interface MaterialFilter {
  counterpartyId?: string;
  supplierId?: string;
  siteId?: string;
  costTypeId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface MaterialRepository {
  /** Информация о заявке для страницы материалов (null → 404). */
  getRequestInfo(paymentRequestId: string): Promise<Row | null>;
  /** Справочник материалов {id,name,unit} по name. */
  listDictionary(): Promise<Row[]>;
  /** Заявки с распознанными материалами: агрегаты позиций/суммы/счетов + данные заявки. */
  listRequests(): Promise<Row[]>;
  /** Распознанные материалы заявки (с material_name/unit), по position. */
  listRecognized(paymentRequestId: string): Promise<Row[]>;
  /** Обновить estimate_quantity позиции. */
  updateEstimate(id: string, estimateQuantity: number | null): Promise<void>;
  /** Свод по материалам (группировка по material_id) с фильтрами. */
  getSummary(filter: MaterialFilter): Promise<Row[]>;
  /** Иерархический свод (сырые строки для клиента) с фильтрами. */
  getHierarchicalSummary(filter: MaterialFilter): Promise<Row[]>;
  /** Файлы-счета заявки (document_type = "Счет"). */
  listInvoiceFiles(paymentRequestId: string): Promise<Row[]>;
}
