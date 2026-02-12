import { create } from 'zustand'
import { supabase } from '@/services/supabase'
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
      const { data, error } = await supabase
        .from('ocr_models')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error

      const models = data as OcrModel[]
      const active = models.find((m) => m.isActive)
      set({ ocrModels: models, activeModelId: active?.id ?? null, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки моделей'
      set({ error: message, isLoading: false })
    }
  },

  addOcrModel: async (data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('ocr_models').insert(data)
      if (error) throw error
      await get().fetchOcrModels()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка добавления модели'
      set({ error: message, isLoading: false })
    }
  },

  deleteOcrModel: async (id) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('ocr_models').delete().eq('id', id)
      if (error) throw error
      await get().fetchOcrModels()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления модели'
      set({ error: message, isLoading: false })
    }
  },

  setActiveModel: async (id) => {
    set({ isLoading: true, error: null })
    try {
      // Деактивируем все модели
      await supabase.from('ocr_models').update({ is_active: false }).neq('id', '')
      // Активируем выбранную
      const { error } = await supabase.from('ocr_models').update({ is_active: true }).eq('id', id)
      if (error) throw error
      await get().fetchOcrModels()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка смены активной модели'
      set({ error: message, isLoading: false })
    }
  },
}))
