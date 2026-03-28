import { create } from 'zustand'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import type { OmtsRpSite } from '@/types'
import type { OmtsUser } from '@/store/assignmentStore'

interface OmtsRpStoreState {
  sites: OmtsRpSite[]
  responsibleUserId: string | null
  omtsUsers: OmtsUser[]
  isLoading: boolean
  error: string | null

  fetchSites: () => Promise<void>
  addSite: (constructionSiteId: string) => Promise<void>
  removeSite: (siteId: string) => Promise<void>
  fetchConfig: () => Promise<void>
  updateResponsible: (userId: string | null) => Promise<void>
  fetchOmtsUsers: () => Promise<void>
  isOmtsRpSite: (siteId: string) => boolean
  getResponsibleUserId: () => string | null
}

export const useOmtsRpStore = create<OmtsRpStoreState>((set, get) => ({
  sites: [],
  responsibleUserId: null,
  omtsUsers: [],
  isLoading: false,
  error: null,

  fetchSites: async () => {
    set({ isLoading: true, error: null })
    try {
      const data = await api.get<OmtsRpSite[]>('/api/omts-rp/sites')

      set({ sites: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки объектов ОМТС РП'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchOmtsRpSites' } })
      set({ error: message, isLoading: false })
    }
  },

  addSite: async (constructionSiteId) => {
    set({ error: null })
    try {
      await api.post('/api/omts-rp/sites', { constructionSiteId })

      await get().fetchSites()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка добавления объекта'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'addOmtsRpSite' } })
      set({ error: message })
      throw err
    }
  },

  removeSite: async (siteId) => {
    set({ error: null })
    try {
      await api.delete(`/api/omts-rp/sites/${siteId}`)

      await get().fetchSites()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления объекта'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'removeOmtsRpSite' } })
      set({ error: message })
      throw err
    }
  },

  fetchConfig: async () => {
    try {
      const data = await api.get<{ responsibleUserId: string | null }>('/api/omts-rp/config')

      set({ responsibleUserId: data?.responsibleUserId ?? null })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки конфигурации ОМТС РП'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchOmtsRpConfig' } })
      set({ error: message })
    }
  },

  updateResponsible: async (userId) => {
    set({ error: null })
    try {
      await api.put('/api/omts-rp/responsible', { userId })

      set({ responsibleUserId: userId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления ответственного'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'updateOmtsRpResponsible' } })
      set({ error: message })
      throw err
    }
  },

  fetchOmtsUsers: async () => {
    try {
      const data = await api.get<OmtsUser[]>('/api/omts-rp/omts-users')

      set({ omtsUsers: data ?? [] })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки пользователей ОМТС'
      set({ error: message })
    }
  },

  isOmtsRpSite: (siteId) => {
    return get().sites.some((s) => s.constructionSiteId === siteId)
  },

  getResponsibleUserId: () => {
    return get().responsibleUserId
  },
}))
