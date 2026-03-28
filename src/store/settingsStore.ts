import { create } from 'zustand'
import { api } from '@/services/api'
import type { OcrModel } from '@/types'

interface SettingsStoreState {
  ocrModels: OcrModel[]
  activeModelId: string | null
  isLoading: boolean
  error: string | null
  fetchOcrModels: () => Promise<void>
  addOcrModel: (data: Partial<OcrModel>) => Promise<void>
  deleteOcrModel: (id: string) => Promise<void>
  setActiveModel: (id: string) => Promise<void>
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  ocrModels: [],
  activeModelId: null,
  isLoading: false,
  error: null,

  fetchOcrModels: async () => {
    set({ isLoading: true, error: null })
    try {
      const models = await api.get<OcrModel[]>('/api/settings/ocr-models')
      const active = (models ?? []).find((m) => m.isActive)
      set({ ocrModels: models ?? [], activeModelId: active?.id ?? null, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки моделей'
      set({ error: message, isLoading: false })
    }
  },

  addOcrModel: async (data) => {
    set({ isLoading: true, error: null })
    try {
      await api.post('/api/settings/ocr-models', data)
      await get().fetchOcrModels()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка добавления модели'
      set({ error: message, isLoading: false })
    }
  },

  deleteOcrModel: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await api.delete(`/api/settings/ocr-models/${id}`)
      await get().fetchOcrModels()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления модели'
      set({ error: message, isLoading: false })
    }
  },

  setActiveModel: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await api.put(`/api/settings/ocr-models/${id}/activate`)
      await get().fetchOcrModels()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка смены активной модели'
      set({ error: message, isLoading: false })
    }
  },
}))
