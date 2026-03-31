import { create } from 'zustand'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import { notifyNewComment } from '@/utils/notificationService'
import type { PaymentRequestComment } from '@/types'

interface CommentStoreState {
  comments: PaymentRequestComment[]
  isLoading: boolean
  isSubmitting: boolean
  unreadCounts: Record<string, number>
  fetchComments: (paymentRequestId: string) => Promise<void>
  addComment: (paymentRequestId: string, text: string, userId: string, recipient?: string | null) => Promise<void>
  updateComment: (commentId: string, text: string) => Promise<void>
  deleteComment: (commentId: string) => Promise<void>
  fetchUnreadCounts: (userId: string) => Promise<void>
  markAsRead: (userId: string, paymentRequestId: string) => Promise<void>
}

export const useCommentStore = create<CommentStoreState>((set, get) => ({
  comments: [],
  isLoading: false,
  isSubmitting: false,
  unreadCounts: {},

  fetchComments: async (paymentRequestId) => {
    set({ isLoading: true })
    try {
      const data = await api.get<PaymentRequestComment[]>(
        `/api/comments/payment-request/${paymentRequestId}`,
      )

      set({ comments: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки комментариев'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchComments' } })
      set({ isLoading: false })
    }
  },

  addComment: async (paymentRequestId, text, userId, recipient) => {
    set({ isSubmitting: true })
    try {
      await api.post(`/api/comments/payment-request`, {
        paymentRequestId,
        text,
        userId,
        recipient: recipient || null,
      })

      // Уведомление получателям комментария
      notifyNewComment(paymentRequestId, userId, recipient || null)

      await get().fetchComments(paymentRequestId)
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка добавления комментария'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'addComment' } })
      set({ isSubmitting: false })
      throw err
    }
  },

  updateComment: async (commentId, text) => {
    set({ isSubmitting: true })
    try {
      await api.put(`/api/comments/${commentId}`, { text })

      // Обновляем локально
      const comment = get().comments.find((c) => c.id === commentId)
      if (comment) {
        await get().fetchComments(comment.paymentRequestId)
      }
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления комментария'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'updateComment' } })
      set({ isSubmitting: false })
      throw err
    }
  },

  deleteComment: async (commentId) => {
    set({ isSubmitting: true })
    try {
      const comment = get().comments.find((c) => c.id === commentId)

      await api.delete(`/api/comments/${commentId}`)

      if (comment) {
        await get().fetchComments(comment.paymentRequestId)
      }
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления комментария'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'deleteComment' } })
      set({ isSubmitting: false })
      throw err
    }
  },

  fetchUnreadCounts: async (_userId) => {
    try {
      const data = await api.get<Record<string, number>>(
        '/api/comments/payment-request/unread-counts',
      )

      set({ unreadCounts: data ?? {} })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки непрочитанных'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchUnreadCounts' } })
    }
  },

  markAsRead: async (_userId, paymentRequestId) => {
    try {
      await api.post(`/api/comments/payment-request/${paymentRequestId}/mark-read`)

      // Обнуляем счётчик локально
      set((state) => {
        const updated = { ...state.unreadCounts }
        delete updated[paymentRequestId]
        return { unreadCounts: updated }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка отметки прочтения'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'markAsRead' } })
    }
  },
}))
