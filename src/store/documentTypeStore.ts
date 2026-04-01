import { create } from 'zustand'
import { api } from '@/services/api'
import type { DocumentType } from '@/types'

interface DocumentTypeStoreState {
  documentTypes: DocumentType[]
  isLoading: boolean
  error: string | null
  /** Загрузка типов документов. Если передана category — фильтрация на сервере */
  fetchDocumentTypes: (category?: string) => Promise<void>
  createDocumentType: (data: Partial<DocumentType>) => Promise<void>
  updateDocumentType: (id: string, data: Partial<DocumentType>) => Promise<void>
  deleteDocumentType: (id: string) => Promise<void>
}

export const useDocumentTypeStore = create<DocumentTypeStoreState>((set, get) => ({
  documentTypes: [],
  isLoading: false,
  error: null,

  fetchDocumentTypes: async (category?: string) => {
    set({ isLoading: true, error: null })
    try {
      const url = category
        ? `/api/references/document-types?category=${category}`
        : '/api/references/document-types'
      const data = await api.get<DocumentType[]>(url)
      set({ documentTypes: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки'
      set({ error: message, isLoading: false })
    }
  },

  createDocumentType: async (data) => {
    set({ isLoading: true, error: null })
    try {
      const body: Record<string, unknown> = { name: data.name }
      if (data.category) body.category = data.category
      await api.post('/api/references/document-types', body)
      await get().fetchDocumentTypes()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания'
      set({ error: message, isLoading: false })
    }
  },

  updateDocumentType: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      const body: Record<string, unknown> = { name: data.name }
      if (data.category) body.category = data.category
      await api.put(`/api/references/document-types/${id}`, body)
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
