import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { RecognizedMaterial } from '@/types'

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
}

// ID типа документа "Счет"
const INVOICE_DOC_TYPE_ID = 'c3c0b242-8a0c-4e20-b9ad-363ebf462a5b'

export const useMaterialsStore = create<MaterialsStoreState>((set) => ({
  requests: [],
  isLoadingRequests: false,

  materials: [],
  isLoadingMaterials: false,

  invoiceFiles: [],

  summary: [],
  isLoadingSummary: false,

  fetchRequests: async () => {
    set({ isLoadingRequests: true })
    try {
      // Получаем уникальные payment_request_id, у которых есть распознанные материалы
      const { data: matData, error: matError } = await supabase
        .from('recognized_materials')
        .select('payment_request_id')
      if (matError) throw matError

      const uniqueIds = [...new Set((matData ?? []).map((r: Record<string, unknown>) => r.payment_request_id as string))]
      if (uniqueIds.length === 0) {
        set({ requests: [], isLoadingRequests: false })
        return
      }

      // Подсчет позиций и суммы по каждой заявке
      const countMap: Record<string, { count: number; total: number }> = {}
      for (const row of matData ?? []) {
        const id = row.payment_request_id as string
        if (!countMap[id]) countMap[id] = { count: 0, total: 0 }
        countMap[id].count++
      }

      // Получаем суммы
      const { data: amountData, error: amountError } = await supabase
        .from('recognized_materials')
        .select('payment_request_id, amount')
        .in('payment_request_id', uniqueIds)
      if (amountError) throw amountError

      for (const row of amountData ?? []) {
        const id = row.payment_request_id as string
        if (countMap[id]) {
          countMap[id].total += Number(row.amount ?? 0)
        }
      }

      // Загружаем данные заявок
      const { data: prData, error: prError } = await supabase
        .from('payment_requests')
        .select('id, request_number, approved_at, counterparties(name), suppliers(name), construction_sites(name)')
        .in('id', uniqueIds)
        .order('approved_at', { ascending: false })
      if (prError) throw prError

      const requests: MaterialsRequestRow[] = (prData ?? []).map((row: Record<string, unknown>) => {
        const cp = row.counterparties as Record<string, unknown> | null
        const sup = row.suppliers as Record<string, unknown> | null
        const site = row.construction_sites as Record<string, unknown> | null
        const id = row.id as string
        return {
          paymentRequestId: id,
          requestNumber: row.request_number as string,
          counterpartyName: (cp?.name as string) ?? '',
          supplierName: (sup?.name as string) ?? '',
          approvedAt: row.approved_at as string | null,
          siteName: (site?.name as string) ?? '',
          itemsCount: countMap[id]?.count ?? 0,
          totalAmount: countMap[id]?.total ?? 0,
        }
      })

      set({ requests, isLoadingRequests: false })
    } catch {
      set({ isLoadingRequests: false })
    }
  },

  fetchMaterials: async (paymentRequestId) => {
    set({ isLoadingMaterials: true, materials: [] })
    try {
      const { data, error } = await supabase
        .from('recognized_materials')
        .select('id, payment_request_id, file_id, material_id, page_number, position, article, quantity, price, amount, estimate_quantity, created_at, materials_dictionary(name, unit)')
        .eq('payment_request_id', paymentRequestId)
        .order('position', { ascending: true })
      if (error) throw error

      const materials: RecognizedMaterial[] = (data ?? []).map((row: Record<string, unknown>) => {
        const mat = row.materials_dictionary as Record<string, unknown> | null
        return {
          id: row.id as string,
          paymentRequestId: row.payment_request_id as string,
          fileId: row.file_id as string | null,
          materialId: row.material_id as string,
          pageNumber: row.page_number as number | null,
          position: row.position as number,
          article: row.article as string | null,
          quantity: row.quantity as number | null,
          price: row.price as number | null,
          amount: row.amount as number | null,
          estimateQuantity: row.estimate_quantity as number | null,
          createdAt: row.created_at as string,
          materialName: mat?.name as string | undefined,
          materialUnit: mat?.unit as string | null | undefined,
        }
      })

      set({ materials, isLoadingMaterials: false })
    } catch {
      set({ isLoadingMaterials: false })
    }
  },

  fetchInvoiceFiles: async (paymentRequestId) => {
    try {
      const { data, error } = await supabase
        .from('payment_request_files')
        .select('id, file_key, file_name, mime_type')
        .eq('payment_request_id', paymentRequestId)
        .eq('document_type_id', INVOICE_DOC_TYPE_ID)
      if (error) throw error

      set({
        invoiceFiles: (data ?? []).map((row: Record<string, unknown>) => ({
          id: row.id as string,
          fileKey: row.file_key as string,
          fileName: row.file_name as string,
          mimeType: row.mime_type as string | null,
        })),
      })
    } catch {
      set({ invoiceFiles: [] })
    }
  },

  updateEstimateQuantity: async (id, value) => {
    try {
      const { error } = await supabase
        .from('recognized_materials')
        .update({ estimate_quantity: value })
        .eq('id', id)
      if (error) throw error

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
      // Собираем все распознанные материалы с фильтрацией по заявкам
      let query = supabase
        .from('recognized_materials')
        .select('material_id, quantity, price, amount, estimate_quantity, payment_requests!inner(counterparty_id, supplier_id, site_id, approved_at), materials_dictionary!inner(name, unit)')

      if (filters?.counterpartyId) {
        query = query.eq('payment_requests.counterparty_id', filters.counterpartyId)
      }
      if (filters?.supplierId) {
        query = query.eq('payment_requests.supplier_id', filters.supplierId)
      }
      if (filters?.siteId) {
        query = query.eq('payment_requests.site_id', filters.siteId)
      }
      if (filters?.dateFrom) {
        query = query.gte('payment_requests.approved_at', filters.dateFrom)
      }
      if (filters?.dateTo) {
        query = query.lte('payment_requests.approved_at', filters.dateTo)
      }

      const { data, error } = await query
      if (error) throw error

      // Группируем по material_id
      const grouped: Record<string, SummaryRow> = {}
      for (const row of data ?? []) {
        const r = row as Record<string, unknown>
        const matId = r.material_id as string
        const mat = r.materials_dictionary as Record<string, unknown>

        if (!grouped[matId]) {
          grouped[matId] = {
            materialId: matId,
            materialName: mat.name as string,
            materialUnit: mat.unit as string | null,
            totalQuantity: 0,
            averagePrice: 0,
            totalAmount: 0,
            totalEstimateQuantity: 0,
          }
        }

        grouped[matId].totalQuantity += Number(r.quantity ?? 0)
        grouped[matId].totalAmount += Number(r.amount ?? 0)
        grouped[matId].totalEstimateQuantity += Number(r.estimate_quantity ?? 0)
      }

      // Рассчитываем среднюю цену
      const summary = Object.values(grouped).map((row) => ({
        ...row,
        averagePrice: row.totalQuantity > 0 ? row.totalAmount / row.totalQuantity : 0,
      }))

      summary.sort((a, b) => a.materialName.localeCompare(b.materialName, 'ru'))

      set({ summary, isLoadingSummary: false })
    } catch {
      set({ isLoadingSummary: false })
    }
  },
}))
