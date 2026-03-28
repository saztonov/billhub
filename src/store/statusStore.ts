import { create } from 'zustand'
import { api } from '@/services/api'
import type { Status } from '@/types'

interface StatusStoreState {
  statuses: Status[]
  isLoading: boolean
  error: string | null
  fetchStatuses: (entityType: string) => Promise<void>
  createStatus: (data: {
    entity_type: string
    code: string
    name: string
    color?: string
    is_active?: boolean
    display_order?: number
  }) => Promise<void>
  updateStatus: (id: string, data: Record<string, unknown>) => Promise<void>
  deleteStatus: (id: string) => Promise<void>
}

export const useStatusStore = create<StatusStoreState>((set, get) => ({
  statuses: [],
  isLoading: false,
  error: null,

  fetchStatuses: async (entityType) => {
    set({ isLoading: true, error: null })
    try {
      const data = await api.get<Status[]>('/api/references/statuses', { entityType })
      set({ statuses: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки статусов'
      set({ error: message, isLoading: false })
    }
  },

  createStatus: async (data) => {
    set({ isLoading: true, error: null })
    try {
      await api.post('/api/references/statuses', data)
      await get().fetchStatuses(data.entity_type)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания статуса'
      set({ error: message, isLoading: false })
    }
  },

  updateStatus: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      await api.put(`/api/references/statuses/${id}`, data)
      // Перезагружаем статусы текущей сущности
      const current = get().statuses[0]
      if (current) await get().fetchStatuses(current.entityType)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления статуса'
      set({ error: message, isLoading: false })
    }
  },

  deleteStatus: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await api.delete(`/api/references/statuses/${id}`)
      const current = get().statuses[0]
      if (current) await get().fetchStatuses(current.entityType)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления статуса'
      set({ error: message, isLoading: false })
    }
  },
}))
