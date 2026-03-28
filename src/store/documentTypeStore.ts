import { create } from 'zustand'
import { api } from '@/services/api'
import type { DocumentType } from '@/types'

interface DocumentTypeStoreState {
  documentTypes: DocumentType[]
  isLoading: boolean
  error: string | null
  fetchDocumentTypes: () => Promise<void>
  createDocumentType: (data: Partial<DocumentType>) => Promise<void>
  updateDocumentType: (id: string, data: Partial<DocumentType>) => Promise<void>
  deleteDocumentType: (id: string) => Promise<void>
}

export const useDocumentTypeStore = create<DocumentTypeStoreState>((set, get) => ({
  documentTypes: [],
  isLoading: false,
  error: null,

  fetchDocumentTypes: async () => {
    set({ isLoading: true, error: null })
    try {
      const data = await api.get<DocumentType[]>('/api/references/document-types')
      set({ documentTypes: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки'
      set({ error: message, isLoading: false })
    }
  },

  createDocumentType: async (data) => {
    set({ isLoading: true, error: null })
    try {
      await api.post('/api/references/document-types', { name: data.name })
      await get().fetchDocumentTypes()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания'
      set({ error: message, isLoading: false })
    }
  },

  updateDocumentType: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      await api.put(`/api/references/document-types/${id}`, { name: data.name })
      await get().fetchDocumentTypes()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления'
      set({ error: message, isLoading: false })
    }
  },

  deleteDocumentType: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await api.delete(`/api/references/document-types/${id}`)
      await get().fetchDocumentTypes()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления'
      set({ error: message, isLoading: false })
    }
  },
}))
