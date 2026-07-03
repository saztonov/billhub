import { create } from 'zustand'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import type { RpLetter, RpDocumentsResult, RpDocumentRef } from '@/types'

/** Вход создания РП. */
export interface CreateRpPayload {
  supplierId: string
  counterpartyId: string
  siteId: string
  paymentRequestIds: string[]
  documents: RpDocumentRef[]
  letterDate?: string | null
}

interface RpStoreState {
  letters: RpLetter[]
  lettersLoading: boolean
  documents: RpDocumentsResult | null
  documentsLoading: boolean

  loadRegistry: () => Promise<void>
  loadDocuments: (supplierId: string, counterpartyId: string, siteId: string) => Promise<void>
  clearDocuments: () => void
  createLetter: (payload: CreateRpPayload) => Promise<RpLetter | null>
  updateStatus: (id: string, status: string) => Promise<boolean>
}

export const useRpStore = create<RpStoreState>((set, get) => ({
  letters: [],
  lettersLoading: false,
  documents: null,
  documentsLoading: false,

  loadRegistry: async () => {
    set({ lettersLoading: true })
    try {
      const data = await api.get<RpLetter[]>('/api/rp')
      set({ letters: data ?? [] })
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка загрузки реестра РП',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'loadRegistry' },
      })
    } finally {
      set({ lettersLoading: false })
    }
  },

  loadDocuments: async (supplierId, counterpartyId, siteId) => {
    set({ documentsLoading: true, documents: null })
    try {
      const params = new URLSearchParams({ supplierId, counterpartyId, siteId })
      const data = await api.get<RpDocumentsResult>(`/api/rp/documents?${params.toString()}`)
      set({ documents: data ?? { contract: [], founding: [] } })
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка загрузки документов РП',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'loadDocuments' },
      })
      set({ documents: { contract: [], founding: [] } })
    } finally {
      set({ documentsLoading: false })
    }
  },

  clearDocuments: () => set({ documents: null }),

  createLetter: async (payload) => {
    try {
      const letter = await api.post<RpLetter>('/api/rp', payload)
      if (letter) set({ letters: [letter, ...get().letters] })
      return letter ?? null
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка создания РП',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'createLetter' },
      })
      throw err
    }
  },

  updateStatus: async (id, status) => {
    try {
      await api.patch(`/api/rp/${id}/status`, { status })
      set({
        letters: get().letters.map((l) => (l.id === id ? { ...l, status } : l)),
      })
      return true
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка смены статуса РП',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'updateStatus' },
      })
      return false
    }
  },
}))
