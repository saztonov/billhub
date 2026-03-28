import { create } from 'zustand'
import { api } from '@/services/api'
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
      const data = await api.get<CostType[]>('/api/references/cost-types')
      set({ costTypes: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки видов затрат'
      set({ error: message, isLoading: false })
    }
  },

  createCostType: async (name) => {
    set({ isLoading: true, error: null })
    try {
      await api.post('/api/references/cost-types', { name })
      await get().fetchCostTypes()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания'
      set({ error: message, isLoading: false })
    }
  },

  updateCostType: async (id, name, isActive) => {
    set({ isLoading: true, error: null })
    try {
      await api.put(`/api/references/cost-types/${id}`, { name, isActive })
      await get().fetchCostTypes()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления'
      set({ error: message, isLoading: false })
    }
  },

  deleteCostType: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await api.delete(`/api/references/cost-types/${id}`)
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
      const batch = names.slice(i, i + BATCH_SIZE)
      await api.post('/api/references/cost-types/batch-import', { items: batch })
      created += batch.length
      onProgress?.(created, names.length)
    }
    await get().fetchCostTypes()
    return created
  },
}))
