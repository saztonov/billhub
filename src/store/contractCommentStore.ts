import { create } from 'zustand'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import type { ContractRequestComment } from '@/types'

interface ContractCommentStoreState {
  comments: ContractRequestComment[]
  isLoading: boolean
  isSubmitting: boolean
  unreadCounts: Record<string, number>
  fetchComments: (contractRequestId: string) => Promise<void>
  addComment: (contractRequestId: string, text: string, userId: string, recipient?: string | null) => Promise<void>
  updateComment: (commentId: string, text: string) => Promise<void>
  deleteComment: (commentId: string) => Promise<void>
  fetchUnreadCounts: (userId: string) => Promise<void>
  markAsRead: (userId: string, contractRequestId: string) => Promise<void>
}

export const useContractCommentStore = create<ContractCommentStoreState>((set, get) => ({
  comments: [],
  isLoading: false,
  isSubmitting: false,
  unreadCounts: {},

  fetchComments: async (contractRequestId) => {
    set({ isLoading: true })
    try {
      const data = await api.get<ContractRequestComment[]>(
        `/api/comments/contract-request/${contractRequestId}`,
      )

      set({ comments: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки комментариев'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchContractComments' } })
      set({ isLoading: false })
    }
  },

  addComment: async (contractRequestId, text, userId, recipient) => {
    set({ isSubmitting: true })
    try {
      await api.post('/api/comments/contract-request', {
        contractRequestId,
        text,
        userId,
        recipient: recipient || null,
      })

      await get().fetchComments(contractRequestId)
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка добавления комментария'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'addContractComment' } })
      set({ isSubmitting: false })
      throw err
    }
  },

  updateComment: async (commentId, text) => {
    set({ isSubmitting: true })
    try {
      await api.put(`/api/comments/contract/${commentId}`, { text })

      const comment = get().comments.find((c) => c.id === commentId)
      if (comment) {
        await get().fetchComments(comment.contractRequestId)
      }
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления комментария'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'updateContractComment' } })
      set({ isSubmitting: false })
      throw err
    }
  },

  deleteComment: async (commentId) => {
    set({ isSubmitting: true })
    try {
      const comment = get().comments.find((c) => c.id === commentId)

      await api.delete(`/api/comments/contract/${commentId}`)

      if (comment) {
        await get().fetchComments(comment.contractRequestId)
      }
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления комментария'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'deleteContractComment' } })
      set({ isSubmitting: false })
      throw err
    }
  },

  fetchUnreadCounts: async (_userId) => {
    try {
      const data = await api.get<Record<string, number>>(
        '/api/comments/contract-request/unread-counts',
      )

      set({ unreadCounts: data ?? {} })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки непрочитанных'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchContractUnreadCounts' } })
    }
  },

  markAsRead: async (_userId, contractRequestId) => {
    try {
      await api.post(`/api/comments/contract-request/${contractRequestId}/mark-read`)

      set((state) => {
        const updated = { ...state.unreadCounts }
        delete updated[contractRequestId]
        return { unreadCounts: updated }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка отметки прочтения'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'markContractAsRead' } })
    }
  },
}))
