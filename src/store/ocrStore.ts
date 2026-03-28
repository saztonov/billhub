import { create } from 'zustand'
import { api } from '@/services/api'
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
      const data = await api.get<{
        autoEnabled: boolean
        activeModelId: string
        models: OcrModelSetting[]
      }>('/api/ocr/settings')

      set({
        autoEnabled: data?.autoEnabled ?? false,
        activeModelId: data?.activeModelId ?? '',
        models: data?.models ?? [],
        isLoadingSettings: false,
      })
    } catch {
      set({ isLoadingSettings: false })
    }
  },

  setAutoEnabled: async (enabled) => {
    try {
      await api.put('/api/ocr/settings/auto-enabled', { enabled })
      set({ autoEnabled: enabled })
    } catch { /* ошибка игнорируется — UI обновится при следующем fetch */ }
  },

  setActiveModelId: async (modelId) => {
    try {
      await api.put('/api/ocr/settings/active-model', { modelId })
      set({ activeModelId: modelId })
    } catch { /* */ }
  },

  addModel: async (model) => {
    const current = get().models
    const updated = [...current, model]
    try {
      await api.post('/api/ocr/models', model)
      set({ models: updated })
    } catch { /* */ }
  },

  updateModel: async (id, partial) => {
    const current = get().models
    const updated = current.map((m) => (m.id === id ? { ...m, ...partial } : m))
    try {
      await api.put(`/api/ocr/models/${id}`, partial)
      set({ models: updated })
    } catch { /* */ }
  },

  removeModel: async (id) => {
    const current = get().models
    const updated = current.filter((m) => m.id !== id)
    try {
      await api.delete(`/api/ocr/models/${id}`)
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
      const data = await api.get<{ logs: OcrRecognitionLog[]; total: number }>(
        '/api/ocr/logs',
        { page, pageSize },
      )

      set({
        logs: data?.logs ?? [],
        isLoadingLogs: false,
        logsTotal: data?.total ?? 0,
      })
    } catch {
      set({ isLoadingLogs: false })
    }
  },

  fetchTokenStats: async () => {
    try {
      const data = await api.get<Record<string, OcrTokenStats>>('/api/ocr/token-stats')

      set({ tokenStats: data ?? {} })
    } catch { /* */ }
  },

  fetchLogMaterials: async (paymentRequestId) => {
    set({ isLoadingLogMaterials: true, logMaterials: [] })
    try {
      const data = await api.get<RecognizedMaterial[]>(
        `/api/materials/recognized/${paymentRequestId}`,
      )

      set({ logMaterials: data ?? [], isLoadingLogMaterials: false })
    } catch {
      set({ isLoadingLogMaterials: false })
    }
  },
}))
