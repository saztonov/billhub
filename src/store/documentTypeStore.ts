import { create } from 'zustand'
import { supabase } from '@/services/supabase'
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
      const { data, error } = await supabase
        .from('document_types')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      set({ documentTypes: data as DocumentType[], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки'
      set({ error: message, isLoading: false })
    }
  },

  createDocumentType: async (data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('document_types').insert(data)
      if (error) throw error
      await get().fetchDocumentTypes()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания'
      set({ error: message, isLoading: false })
    }
  },

  updateDocumentType: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('document_types').update(data).eq('id', id)
      if (error) throw error
      await get().fetchDocumentTypes()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления'
      set({ error: message, isLoading: false })
    }
  },

  deleteDocumentType: async (id) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('document_types').delete().eq('id', id)
      if (error) throw error
      await get().fetchDocumentTypes()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления'
      set({ error: message, isLoading: false })
    }
  },
}))
