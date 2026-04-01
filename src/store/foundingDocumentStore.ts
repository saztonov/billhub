import { create } from 'zustand'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import type { FoundingDocumentRow, FoundingDocumentFile } from '@/types'

interface FoundingDocumentStoreState {
  documents: FoundingDocumentRow[]
  files: FoundingDocumentFile[]
  isLoading: boolean
  isFilesLoading: boolean
  error: string | null

  fetchDocuments: (supplierId: string) => Promise<void>
  updateDocument: (
    supplierId: string,
    typeId: string,
    data: { isAvailable?: boolean; comment?: string }
  ) => Promise<void>
  fetchFiles: (supplierId: string, typeId: string) => Promise<void>
  deleteFile: (fileId: string) => Promise<void>
}

export const useFoundingDocumentStore = create<FoundingDocumentStoreState>((set, get) => ({
  documents: [],
  files: [],
  isLoading: false,
  isFilesLoading: false,
  error: null,

  fetchDocuments: async (supplierId) => {
    set({ isLoading: true, error: null })
    try {
      const data = await api.get<FoundingDocumentRow[]>(
        `/api/founding-documents/${supplierId}`
      )
      set({ documents: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки'
      logError({
        errorType: 'api_error',
        errorMessage: message,
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'fetchFoundingDocuments' },
      })
      set({ error: message, isLoading: false })
    }
  },

  updateDocument: async (supplierId, typeId, data) => {
    set({ error: null })
    try {
      await api.put(`/api/founding-documents/${supplierId}/${typeId}`, data)
      await get().fetchDocuments(supplierId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления'
      logError({
        errorType: 'api_error',
        errorMessage: message,
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'updateFoundingDocument' },
      })
      set({ error: message })
    }
  },

  fetchFiles: async (supplierId, typeId) => {
    set({ isFilesLoading: true, error: null })
    try {
      const data = await api.get<FoundingDocumentFile[]>(
        `/api/founding-documents/${supplierId}/${typeId}/files`
      )
      set({ files: data ?? [], isFilesLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки файлов'
      logError({
        errorType: 'api_error',
        errorMessage: message,
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'fetchFoundingDocumentFiles' },
      })
      set({ error: message, isFilesLoading: false })
    }
  },

  deleteFile: async (fileId) => {
    set({ error: null })
    try {
      await api.delete(`/api/founding-documents/files/${fileId}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления файла'
      logError({
        errorType: 'api_error',
        errorMessage: message,
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'deleteFoundingDocumentFile' },
      })
      set({ error: message })
      throw err
    }
  },
}))
