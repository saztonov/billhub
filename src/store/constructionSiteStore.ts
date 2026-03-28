import { create } from 'zustand'
import { api } from '@/services/api'
import type { ConstructionSite } from '@/types'

interface ConstructionSiteStoreState {
  sites: ConstructionSite[]
  isLoading: boolean
  error: string | null
  fetchSites: () => Promise<void>
  createSite: (data: Partial<ConstructionSite>) => Promise<void>
  updateSite: (id: string, data: Partial<ConstructionSite>) => Promise<void>
  deleteSite: (id: string) => Promise<void>
}

export const useConstructionSiteStore = create<ConstructionSiteStoreState>((set, get) => ({
  sites: [],
  isLoading: false,
  error: null,

  fetchSites: async () => {
    set({ isLoading: true, error: null })
    try {
      const data = await api.get<ConstructionSite[]>('/api/references/construction-sites')
      set({ sites: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки объектов'
      set({ error: message, isLoading: false })
    }
  },

  createSite: async (data) => {
    set({ isLoading: true, error: null })
    try {
      await api.post('/api/references/construction-sites', {
        name: data.name,
        isActive: data.isActive ?? true,
      })
      await get().fetchSites()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания объекта'
      set({ error: message, isLoading: false })
    }
  },

  updateSite: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      await api.put(`/api/references/construction-sites/${id}`, {
        name: data.name,
        isActive: data.isActive,
      })
      await get().fetchSites()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления объекта'
      set({ error: message, isLoading: false })
    }
  },

  deleteSite: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await api.delete(`/api/references/construction-sites/${id}`)
      await get().fetchSites()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления объекта'
      set({ error: message, isLoading: false })
    }
  },
}))
