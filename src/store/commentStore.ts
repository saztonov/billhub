import { create } from 'zustand'
import { supabase } from '@/services/supabase'
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
      const { data, error } = await supabase
        .from('payment_request_comments')
        .select('id, payment_request_id, author_id, text, created_at, updated_at, recipient, author:users!payment_request_comments_author_id_fkey(full_name, email, role, department_id, counterparty:counterparties!users_counterparty_id_fkey(name))')
        .eq('payment_request_id', paymentRequestId)
        .order('created_at', { ascending: false })

      if (error) throw error

      const comments: PaymentRequestComment[] = (data ?? []).map((row: Record<string, unknown>) => {
        const author = row.author as Record<string, unknown> | null
        const counterparty = author?.counterparty as Record<string, unknown> | null
        return {
          id: row.id as string,
          paymentRequestId: row.payment_request_id as string,
          authorId: row.author_id as string,
          text: row.text as string,
          createdAt: row.created_at as string,
          updatedAt: (row.updated_at as string) ?? null,
          authorFullName: (author?.full_name as string) ?? undefined,
          authorEmail: (author?.email as string) ?? undefined,
          authorRole: (author?.role as string) ?? undefined,
          authorDepartment: (author?.department_id as string) ?? null,
          authorCounterpartyName: (counterparty?.name as string) ?? undefined,
          recipient: (row.recipient as string) ?? null,
        }
      })

      set({ comments, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки комментариев'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchComments' } })
      set({ isLoading: false })
    }
  },

  addComment: async (paymentRequestId, text, userId, recipient) => {
    set({ isSubmitting: true })
    try {
      const { error } = await supabase
        .from('payment_request_comments')
        .insert({
          payment_request_id: paymentRequestId,
          author_id: userId,
          text,
          recipient: recipient || null,
        })
      if (error) throw error

      // Уведомляем о новом комментарии
      notifyNewComment(paymentRequestId, userId, recipient || null).catch(() => {})

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
      const { error } = await supabase
        .from('payment_request_comments')
        .update({ text, updated_at: new Date().toISOString() })
        .eq('id', commentId)
      if (error) throw error

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

      const { error } = await supabase
        .from('payment_request_comments')
        .delete()
        .eq('id', commentId)
      if (error) throw error

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

  fetchUnreadCounts: async (userId) => {
    try {
      // Загружаем все комментарии с группировкой по заявке и статусы прочтения
      const { data: comments, error: commentsError } = await supabase
        .from('payment_request_comments')
        .select('payment_request_id, created_at')
        .neq('author_id', userId)

      if (commentsError) throw commentsError

      const { data: readStatuses, error: readError } = await supabase
        .from('comment_read_status')
        .select('payment_request_id, last_read_at')
        .eq('user_id', userId)

      if (readError) throw readError

      // Строим мапу last_read_at по заявке
      const readMap: Record<string, string> = {}
      for (const rs of readStatuses ?? []) {
        readMap[rs.payment_request_id] = rs.last_read_at
      }

      // Считаем непрочитанные
      const counts: Record<string, number> = {}
      for (const c of comments ?? []) {
        const lastRead = readMap[c.payment_request_id]
        if (!lastRead || new Date(c.created_at) > new Date(lastRead)) {
          counts[c.payment_request_id] = (counts[c.payment_request_id] || 0) + 1
        }
      }

      set({ unreadCounts: counts })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки непрочитанных'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchUnreadCounts' } })
    }
  },

  markAsRead: async (userId, paymentRequestId) => {
    try {
      const { error } = await supabase
        .from('comment_read_status')
        .upsert(
          { user_id: userId, payment_request_id: paymentRequestId, last_read_at: new Date().toISOString() },
          { onConflict: 'user_id,payment_request_id' }
        )
      if (error) throw error

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
