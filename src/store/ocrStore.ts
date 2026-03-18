import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { OcrModelSetting, OcrRecognitionLog, OcrTokenStats, RecognizedMaterial } from '@/types'

interface OcrStoreState {
  // Настройки
  autoEnabled: boolean
  activeModelId: string
  models: OcrModelSetting[]
  isLoadingSettings: boolean

  // Логи
  logs: OcrRecognitionLog[]
  isLoadingLogs: boolean
  logsTotal: number

  // Статистика токенов
  tokenStats: Record<string, OcrTokenStats>

  // Результаты распознавания (для модалки)
  logMaterials: RecognizedMaterial[]
  isLoadingLogMaterials: boolean

  // Действия — настройки
  fetchSettings: () => Promise<void>
  setAutoEnabled: (enabled: boolean) => Promise<void>
  setActiveModelId: (modelId: string) => Promise<void>
  addModel: (model: OcrModelSetting) => Promise<void>
  updateModel: (id: string, model: Partial<OcrModelSetting>) => Promise<void>
  removeModel: (id: string) => Promise<void>

  // Действия — логи
  fetchLogs: (page?: number, pageSize?: number) => Promise<void>
  fetchTokenStats: () => Promise<void>
  fetchLogMaterials: (paymentRequestId: string) => Promise<void>
}

export const useOcrStore = create<OcrStoreState>((set, get) => ({
  autoEnabled: false,
  activeModelId: '',
  models: [],
  isLoadingSettings: false,

  logs: [],
  isLoadingLogs: false,
  logsTotal: 0,

  tokenStats: {},

  logMaterials: [],
  isLoadingLogMaterials: false,

  fetchSettings: async () => {
    set({ isLoadingSettings: true })
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('key, value')
        .in('key', ['ocr_auto_enabled', 'ocr_active_model_id', 'ocr_models'])
      if (error) throw error

      const settings: Record<string, unknown> = {}
      for (const row of data ?? []) {
        settings[row.key as string] = row.value
      }

      const autoVal = settings['ocr_auto_enabled'] as { enabled?: boolean } | undefined
      const modelVal = settings['ocr_active_model_id'] as { modelId?: string } | undefined
      const modelsVal = settings['ocr_models'] as { models?: OcrModelSetting[] } | undefined

      set({
        autoEnabled: autoVal?.enabled ?? false,
        activeModelId: modelVal?.modelId ?? '',
        models: modelsVal?.models ?? [],
        isLoadingSettings: false,
      })
    } catch {
      set({ isLoadingSettings: false })
    }
  },

  setAutoEnabled: async (enabled) => {
    try {
      const { error } = await supabase
        .from('settings')
        .upsert({ key: 'ocr_auto_enabled', value: { enabled } })
      if (error) throw error
      set({ autoEnabled: enabled })
    } catch { /* ошибка игнорируется — UI обновится при следующем fetch */ }
  },

  setActiveModelId: async (modelId) => {
    try {
      const { error } = await supabase
        .from('settings')
        .upsert({ key: 'ocr_active_model_id', value: { modelId } })
      if (error) throw error
      set({ activeModelId: modelId })
    } catch { /* */ }
  },

  addModel: async (model) => {
    const current = get().models
    const updated = [...current, model]
    try {
      const { error } = await supabase
        .from('settings')
        .upsert({ key: 'ocr_models', value: { models: updated } })
      if (error) throw error
      set({ models: updated })
    } catch { /* */ }
  },

  updateModel: async (id, partial) => {
    const current = get().models
    const updated = current.map((m) => (m.id === id ? { ...m, ...partial } : m))
    try {
      const { error } = await supabase
        .from('settings')
        .upsert({ key: 'ocr_models', value: { models: updated } })
      if (error) throw error
      set({ models: updated })
    } catch { /* */ }
  },

  removeModel: async (id) => {
    const current = get().models
    const updated = current.filter((m) => m.id !== id)
    try {
      const { error } = await supabase
        .from('settings')
        .upsert({ key: 'ocr_models', value: { models: updated } })
      if (error) throw error
      set({ models: updated })
      // Если удалили активную модель — сбросить
      if (get().activeModelId === id) {
        await get().setActiveModelId(updated[0]?.id ?? '')
      }
    } catch { /* */ }
  },

  fetchLogs: async (page = 1, pageSize = 50) => {
    set({ isLoadingLogs: true })
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      const { data, error, count } = await supabase
        .from('ocr_recognition_log')
        .select('id, payment_request_id, file_id, model_id, status, error_message, attempt_number, input_tokens, output_tokens, total_cost, started_at, completed_at, payment_requests(request_number)', { count: 'exact' })
        .order('started_at', { ascending: false })
        .range(from, to)
      if (error) throw error

      const logs: OcrRecognitionLog[] = (data ?? []).map((row: Record<string, unknown>) => {
        const pr = row.payment_requests as Record<string, unknown> | null
        return {
          id: row.id as string,
          paymentRequestId: row.payment_request_id as string,
          fileId: row.file_id as string | null,
          modelId: row.model_id as string,
          status: row.status as OcrRecognitionLog['status'],
          errorMessage: row.error_message as string | null,
          attemptNumber: row.attempt_number as number,
          inputTokens: row.input_tokens as number | null,
          outputTokens: row.output_tokens as number | null,
          totalCost: row.total_cost as number | null,
          startedAt: row.started_at as string,
          completedAt: row.completed_at as string | null,
          requestNumber: pr?.request_number as string | undefined,
        }
      })

      set({ logs, isLoadingLogs: false, logsTotal: count ?? 0 })
    } catch {
      set({ isLoadingLogs: false })
    }
  },

  fetchTokenStats: async () => {
    try {
      const now = new Date()
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 1).toISOString()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

      const fetchPeriod = async (from: string): Promise<OcrTokenStats> => {
        const { data, error } = await supabase
          .from('ocr_recognition_log')
          .select('input_tokens, output_tokens, total_cost')
          .gte('started_at', from)
          .eq('status', 'success')
        if (error) throw error

        let inputTokens = 0
        let outputTokens = 0
        let totalCost = 0
        for (const row of data ?? []) {
          inputTokens += (row.input_tokens as number) ?? 0
          outputTokens += (row.output_tokens as number) ?? 0
          totalCost += Number(row.total_cost ?? 0)
        }
        return { inputTokens, outputTokens, totalCost }
      }

      // Все время
      const { data: allData, error: allError } = await supabase
        .from('ocr_recognition_log')
        .select('input_tokens, output_tokens, total_cost')
        .eq('status', 'success')
      if (allError) throw allError

      let allInput = 0, allOutput = 0, allCost = 0
      for (const row of allData ?? []) {
        allInput += (row.input_tokens as number) ?? 0
        allOutput += (row.output_tokens as number) ?? 0
        allCost += Number(row.total_cost ?? 0)
      }

      const [day, week, month] = await Promise.all([
        fetchPeriod(dayStart),
        fetchPeriod(weekStart),
        fetchPeriod(monthStart),
      ])

      set({
        tokenStats: {
          day,
          week,
          month,
          all: { inputTokens: allInput, outputTokens: allOutput, totalCost: allCost },
        },
      })
    } catch { /* */ }
  },

  fetchLogMaterials: async (paymentRequestId) => {
    set({ isLoadingLogMaterials: true, logMaterials: [] })
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

      set({ logMaterials: materials, isLoadingLogMaterials: false })
    } catch {
      set({ isLoadingLogMaterials: false })
    }
  },
}))
