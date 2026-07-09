// Типы раздела «Закупки» (путь 2 — заявки на приобретение через СУ-10).
// Заявки-зеркала импортируются из EstiMat (тип material_requests.request_type='su10'),
// материалы распределяются по поставщикам в лоты/заказы. Пока раздел в разработке —
// это доменный каркас read-моделей, который будут потреблять сторы/компоненты.

/** Режимы отображения материалов к распределению. */
export type ProcurementDistributionMode = 'by-request' | 'to-distribute' | 'by-category'

/** Заявка-зеркало на приобретение СУ-10 (импорт из EstiMat). */
export interface ProcurementRequest {
  id: string
  /** Внешний идентификатор заявки в EstiMat (external_ref). */
  externalRef: string
  /** Номер заявки в EstiMat (снимок). */
  externalNumber: string | null
  /** Подрядчик-заявитель (снимок + локальный маппинг). */
  contractorName: string | null
  contractorInn: string | null
  counterpartyId: string | null
  /** Объект строительства (снимок + локальный маппинг). */
  objectName: string | null
  siteId: string | null
  status: string
  itemsCount: number
  importedAt: string
}

/** Позиция заявки-зеркала (материал в разрезе категории/вида работ). */
export interface ProcurementRequestItem {
  id: string
  procurementRequestId: string
  materialName: string
  materialUnit: string | null
  costCategoryName: string | null
  costTypeName: string | null
  /** Заявленное количество. */
  quantity: number
}

/** Агрегированная строка режима «Материалы к распределению». */
export interface ProcurementMaterialSummaryRow {
  key: string
  materialName: string
  materialUnit: string | null
  costCategoryName: string | null
  costTypeName: string | null
  /** Заявлено суммарно по всем заявкам. */
  requestedQuantity: number
  /** Зарезервировано в лотах (активные аллокации). */
  allocatedQuantity: number
  /** Присуждено поставщику. */
  awardedQuantity: number
  /** Остаток к распределению = заявлено − зарезервировано. */
  remainingQuantity: number
}

/** Лот/заказ поставщику (один подрядчик + один объект). */
export interface ProcurementOrder {
  id: string
  number: string
  contractorName: string | null
  objectName: string | null
  statusCode: string
  statusName: string | null
  totalAmount: number
  createdAt: string
}
