import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { CostType } from '@/types'

interface CostTypeStoreState {
  costTypes: CostType[]
  isLoading: boolean
  error: string | null
  fetchCostTypes: () => Promise<void>
  createCostType: (name: string) => Promise<void>
  updateCostType: (id: string, name: string, isActive: boolean) => Promise<void>
  deleteCostType: (id: string) => Promise<void>
  batchInsertCostTypes: (names: string[], onProgress?: (done: number, total: number) => void) => Promise<number>
}

export const useCostTypeStore = create<CostTypeStoreState>((set, get) => ({
  costTypes: [],
  isLoading: false,
  error: null,

  fetchCostTypes: async () => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('cost_types')
        .select('id, name, is_active, created_at')
        .order('name', { ascending: true })
      if (error) throw error

      const costTypes: CostType[] = (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        name: row.name as string,
        isActive: row.is_active as boolean,
        createdAt: row.created_at as string,
      }))

      set({ costTypes, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки видов затрат'
      set({ error: message, isLoading: false })
    }
  },

  createCostType: async (name) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('cost_types').insert({ name })
      if (error) throw error
      await get().fetchCostTypes()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания'
      set({ error: message, isLoading: false })
    }
  },

  updateCostType: async (id, name, isActive) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase
        .from('cost_types')
        .update({ name, is_active: isActive })
        .eq('id', id)
      if (error) throw error
      await get().fetchCostTypes()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления'
      set({ error: message, isLoading: false })
    }
  },

  deleteCostType: async (id) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('cost_types').delete().eq('id', id)
      if (error) throw error
      await get().fetchCostTypes()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления'
      set({ error: message, isLoading: false })
    }
  },

  batchInsertCostTypes: async (names, onProgress) => {
    const BATCH_SIZE = 20
    let created = 0
    for (let i = 0; i < names.length; i += BATCH_SIZE) {
      const batch = names.slice(i, i + BATCH_SIZE).map((name) => ({ name }))
      const { error } = await supabase.from('cost_types').insert(batch)
      if (error) throw error
      created += batch.length
      onProgress?.(created, names.length)
    }
    await get().fetchCostTypes()
    return created
  },
}))
