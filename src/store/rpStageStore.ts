import { create } from 'zustand'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import type { RpStageAssignee, RpStageCandidate } from '@/types'

interface RpStageStoreState {
  /** Все назначения «объект → сотрудник» (админка) */
  assignees: RpStageAssignee[]
  /** Кандидаты в назначенцы (активные сотрудники Штаба/ОМТС) */
  candidates: RpStageCandidate[]
  /** Объекты, на которые назначен текущий пользователь (пусто — не назначенец РП) */
  mySiteIds: string[]
  /** Загружен ли ответ /my (для отличия «не назначен» от «ещё не загружено») */
  myLoaded: boolean
  isLoading: boolean
  error: string | null

  fetchAssignees: () => Promise<void>
  addAssignee: (siteId: string, userId: string) => Promise<void>
  removeAssignee: (id: string) => Promise<void>
  fetchCandidates: () => Promise<void>
  fetchMy: () => Promise<void>
  isAssigneeOf: (siteId: string) => boolean
}

export const useRpStageStore = create<RpStageStoreState>((set, get) => ({
  assignees: [],
  candidates: [],
  mySiteIds: [],
  myLoaded: false,
  isLoading: false,
  error: null,

  fetchAssignees: async () => {
    set({ isLoading: true, error: null })
    try {
      const data = await api.get<RpStageAssignee[]>('/api/rp-stage/assignees')

      set({ assignees: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки назначений РП'
      logError({
        errorType: 'api_error',
        errorMessage: message,
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'fetchRpStageAssignees' },
      })
      set({ error: message, isLoading: false })
    }
  },

  addAssignee: async (siteId, userId) => {
    set({ error: null })
    try {
      await api.post('/api/rp-stage/assignees', { siteId, userId })

      await get().fetchAssignees()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка добавления назначения'
      logError({
        errorType: 'api_error',
        errorMessage: message,
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'addRpStageAssignee' },
      })
      set({ error: message })
      throw err
    }
  },

  removeAssignee: async (id) => {
    set({ error: null })
    try {
      await api.delete(`/api/rp-stage/assignees/${id}`)

      await get().fetchAssignees()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления назначения'
      logError({
        errorType: 'api_error',
        errorMessage: message,
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'removeRpStageAssignee' },
      })
      set({ error: message })
      throw err
    }
  },

  fetchCandidates: async () => {
    try {
      const data = await api.get<RpStageCandidate[]>('/api/rp-stage/candidates')

      set({ candidates: data ?? [] })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки кандидатов'
      set({ error: message })
    }
  },

  fetchMy: async () => {
    try {
      const data = await api.get<{ siteIds: string[] }>('/api/rp-stage/my')

      set({ mySiteIds: data?.siteIds ?? [], myLoaded: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки назначений РП'
      logError({
        errorType: 'api_error',
        errorMessage: message,
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'fetchRpStageMy' },
      })
      set({ error: message })
    }
  },

  isAssigneeOf: (siteId) => {
    return get().mySiteIds.includes(siteId)
  },
}))
