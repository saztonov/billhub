import { create } from 'zustand'
import { supabase } from '@/services/supabase'
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
      const { data, error } = await supabase
        .from('construction_sites')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error

      const sites: ConstructionSite[] = (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        name: row.name as string,
        isActive: row.is_active as boolean,
        createdAt: row.created_at as string,
      }))

      set({ sites, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки объектов'
      set({ error: message, isLoading: false })
    }
  },

  createSite: async (data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('construction_sites').insert({
        name: data.name,
        is_active: data.isActive ?? true,
      })
      if (error) throw error
      await get().fetchSites()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания объекта'
      set({ error: message, isLoading: false })
    }
  },

  updateSite: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase
        .from('construction_sites')
        .update({
          name: data.name,
          is_active: data.isActive,
        })
        .eq('id', id)
      if (error) throw error
      await get().fetchSites()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления объекта'
      set({ error: message, isLoading: false })
    }
  },

  deleteSite: async (id) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('construction_sites').delete().eq('id', id)
      if (error) throw error
      await get().fetchSites()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления объекта'
      set({ error: message, isLoading: false })
    }
  },
}))
