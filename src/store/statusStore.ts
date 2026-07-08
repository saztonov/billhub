import { create } from 'zustand'
import { api } from '@/services/api'
import { isFresh, REFERENCE_TTL_MS, singleFlight } from '@/store/fetchGuard'
import type { Status } from '@/types'

interface StatusStoreState {
  statuses: Status[]
  isLoading: boolean
  error: string | null
  /**
   * TTL-кэш с ключом по entityType: переходы «Заявки ↔ Договора» отдаются из кэша
   * без сети, публичный контракт (один массив statuses текущей сущности) сохранён.
   */
  fetchStatuses: (entityType: string, force?: boolean) => Promise<void>
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

// Кэш статусов по типу сущности (payment_request / contract_request / ...)
const statusCache = new Map<string, { data: Status[]; fetchedAt: number }>()

export const useStatusStore = create<StatusStoreState>((set, get) => ({
  statuses: [],
  isLoading: false,
  error: null,

  fetchStatuses: async (entityType, force = false) => {
    const cached = statusCache.get(entityType)
    if (!force && cached && isFresh(cached.fetchedAt, REFERENCE_TTL_MS)) {
      // Отдаём из кэша синхронно (ссылка та же — лишнего ререндера не будет)
      if (get().statuses !== cached.data) set({ statuses: cached.data })
      return
    }
    await singleFlight(`references-statuses|${entityType}`, async () => {
      // Спиннер только на первой загрузке этого типа сущности
      if (!cached) set({ isLoading: true, error: null })
      try {
        const data = (await api.get<Status[]>('/api/references/statuses', { entityType })) ?? []
        statusCache.set(entityType, { data, fetchedAt: Date.now() })
        set({ statuses: data, isLoading: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка загрузки статусов'
        set({ error: message, isLoading: false })
      }
    })
  },

  createStatus: async (data) => {
    set({ isLoading: true, error: null })
    try {
      await api.post('/api/references/statuses', data)
      await get().fetchStatuses(data.entity_type, true)
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
      if (current) await get().fetchStatuses(current.entityType, true)
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
      if (current) await get().fetchStatuses(current.entityType, true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления статуса'
      set({ error: message, isLoading: false })
    }
  },
}))
