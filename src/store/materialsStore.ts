import { create } from 'zustand'
import { api } from '@/services/api'
import type { RecognizedMaterial } from '@/types'

/** Статус проверки материалов */
export interface MaterialsVerification {
  status: 'on_check' | 'verified'
  checkedBy: string
  checkedByName: string
  checkedAt: string
  verifiedBy?: string
  verifiedByName?: string
  verifiedAt?: string
}

/** Заявка с распознанными материалами (для списка на вкладке Счета) */
export interface MaterialsRequestRow {
  paymentRequestId: string
  requestNumber: string
  counterpartyName: string
  supplierName: string
  approvedAt: string | null
  siteName: string
  itemsCount: number
  totalAmount: number
  invoicesCount: number
  materialsVerification: MaterialsVerification | null
}

/** Строка сводной таблицы */
export interface SummaryRow {
  materialId: string
  materialName: string
  materialUnit: string | null
  totalQuantity: number
  averagePrice: number
  totalAmount: number
  totalEstimateQuantity: number
}

/** Сырые данные для иерархической сводной */
export interface HierarchicalRawRow {
  materialId: string
  materialName: string
  materialUnit: string | null
  quantity: number
  price: number
  amount: number
  estimateQuantity: number | null
  costTypeId: string | null
  costTypeName: string | null
  siteId: string
  siteName: string
  counterpartyId: string
  counterpartyName: string
}

/** Строка материала внутри подрядчика */
export interface HierarchyMaterialRow {
  key: string
  materialId: string
  materialName: string
  materialUnit: string | null
  totalQuantity: number
  averagePrice: number
  totalAmount: number
  totalEstimateQuantity: number
  deviation: number
  deviationAmount: number
}

/** Строка подрядчика (раскрываемая) */
export interface HierarchyCounterpartyRow {
  key: string
  counterpartyId: string
  counterpartyName: string
  totalQuantity: number
  totalAmount: number
  totalEstimateQuantity: number
  deviation: number
  deviationAmount: number
  materials: HierarchyMaterialRow[]
}

/** Строка группировки (вид затрат или объект) */
export interface HierarchyGroupRow {
  key: string
  level: 'costType' | 'site'
  label: string
  totalAmount: number
  totalQuantity: number
  totalEstimateQuantity: number
  deviation: number
  deviationAmount: number
}

/** Элемент плоского списка для таблицы */
export type HierarchyFlatRow = HierarchyGroupRow | HierarchyCounterpartyRow

interface MaterialsStoreState {
  // Вкладка Счета
  requests: MaterialsRequestRow[]
  isLoadingRequests: boolean

  // Детали заявки
  materials: RecognizedMaterial[]
  isLoadingMaterials: boolean

  // Файлы-счета заявки (для превью)
  invoiceFiles: { id: string; fileKey: string; fileName: string; mimeType: string | null }[]

  // Сводная
  summary: SummaryRow[]
  isLoadingSummary: boolean

  // Иерархическая сводная
  hierarchicalRaw: HierarchicalRawRow[]
  isLoadingHierarchical: boolean

  // Действия
  fetchRequests: () => Promise<void>
  fetchMaterials: (paymentRequestId: string) => Promise<void>
  fetchInvoiceFiles: (paymentRequestId: string) => Promise<void>
  updateEstimateQuantity: (id: string, value: number | null) => Promise<void>
  fetchSummary: (filters?: {
    counterpartyId?: string
    supplierId?: string
    siteId?: string
    dateFrom?: string
    dateTo?: string
  }) => Promise<void>
  fetchHierarchicalSummary: (filters?: {
    counterpartyId?: string
    supplierId?: string
    siteId?: string
    costTypeId?: string
    dateFrom?: string
    dateTo?: string
  }) => Promise<void>
}

export const useMaterialsStore = create<MaterialsStoreState>((set) => ({
  requests: [],
  isLoadingRequests: false,

  materials: [],
  isLoadingMaterials: false,

  invoiceFiles: [],

  summary: [],
  isLoadingSummary: false,

  hierarchicalRaw: [],
  isLoadingHierarchical: false,

  fetchRequests: async () => {
    set({ isLoadingRequests: true })
    try {
      const data = await api.get<MaterialsRequestRow[]>('/api/materials/requests')

      set({ requests: data ?? [], isLoadingRequests: false })
    } catch {
      set({ isLoadingRequests: false })
    }
  },

  fetchMaterials: async (paymentRequestId) => {
    set({ isLoadingMaterials: true, materials: [] })
    try {
      const data = await api.get<RecognizedMaterial[]>(
        `/api/materials/recognized/${paymentRequestId}`,
      )

      set({ materials: data ?? [], isLoadingMaterials: false })
    } catch {
      set({ isLoadingMaterials: false })
    }
  },

  fetchInvoiceFiles: async (paymentRequestId) => {
    try {
      const data = await api.get<{ id: string; fileKey: string; fileName: string; mimeType: string | null }[]>(
        `/api/materials/invoice-files/${paymentRequestId}`,
      )

      set({ invoiceFiles: data ?? [] })
    } catch {
      set({ invoiceFiles: [] })
    }
  },

  updateEstimateQuantity: async (id, value) => {
    try {
      await api.patch(`/api/materials/recognized/${id}/estimate`, { estimateQuantity: value })

      // Обновляем локально
      set((state) => ({
        materials: state.materials.map((m) =>
          m.id === id ? { ...m, estimateQuantity: value } : m,
        ),
      }))
    } catch { /* */ }
  },

  fetchSummary: async (filters) => {
    set({ isLoadingSummary: true })
    try {
      const params: Record<string, string | number | boolean | undefined> = {}
      if (filters?.counterpartyId) params.counterpartyId = filters.counterpartyId
      if (filters?.supplierId) params.supplierId = filters.supplierId
      if (filters?.siteId) params.siteId = filters.siteId
      if (filters?.dateFrom) params.dateFrom = filters.dateFrom
      if (filters?.dateTo) params.dateTo = filters.dateTo

      const data = await api.get<SummaryRow[]>('/api/materials/summary', params)

      set({ summary: data ?? [], isLoadingSummary: false })
    } catch {
      set({ isLoadingSummary: false })
    }
  },

  fetchHierarchicalSummary: async (filters) => {
    set({ isLoadingHierarchical: true })
    try {
      const params: Record<string, string | number | boolean | undefined> = {}
      if (filters?.counterpartyId) params.counterpartyId = filters.counterpartyId
      if (filters?.supplierId) params.supplierId = filters.supplierId
      if (filters?.siteId) params.siteId = filters.siteId
      if (filters?.costTypeId) params.costTypeId = filters.costTypeId
      if (filters?.dateFrom) params.dateFrom = filters.dateFrom
      if (filters?.dateTo) params.dateTo = filters.dateTo

      const data = await api.get<HierarchicalRawRow[]>('/api/materials/hierarchical-summary', params)

      set({ hierarchicalRaw: data ?? [], isLoadingHierarchical: false })
    } catch {
      set({ isLoadingHierarchical: false })
    }
  },
}))
