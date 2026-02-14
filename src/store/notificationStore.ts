import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { AppNotification, Department } from '@/types'

interface NotificationStoreState {
  notifications: AppNotification[]
  unreadCount: number
  isLoading: boolean
  error: string | null
  fetchNotifications: (userId: string) => Promise<void>
  fetchUnreadCount: (userId: string) => Promise<void>
  markAsRead: (notificationId: string) => Promise<void>
  markAllAsRead: (userId: string) => Promise<void>
}

export const useNotificationStore = create<NotificationStoreState>((set) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  error: null,

  fetchNotifications: async (userId) => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select(`
          *,
          construction_sites(name),
          payment_requests(request_number)
        `)
        .eq('user_id', userId)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error

      const notifications: AppNotification[] = (data ?? []).map((row: Record<string, unknown>) => {
        const site = row.construction_sites as Record<string, unknown> | null
        const pr = row.payment_requests as Record<string, unknown> | null
        return {
          id: row.id as string,
          type: row.type as AppNotification['type'],
          title: row.title as string,
          message: row.message as string,
          userId: row.user_id as string,
          isRead: row.is_read as boolean,
          paymentRequestId: row.payment_request_id as string | null,
          department: (row.department_id as Department | null) ?? null,
          siteId: row.site_id as string | null,
          resolved: row.resolved as boolean,
          resolvedAt: row.resolved_at as string | null,
          createdAt: row.created_at as string,
          siteName: site?.name as string | undefined,
          requestNumber: pr?.request_number as string | undefined,
        }
      })

      set({ notifications, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки уведомлений'
      set({ error: message, isLoading: false })
    }
  },

  fetchUnreadCount: async (userId) => {
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false)
      if (error) throw error
      set({ unreadCount: count ?? 0 })
    } catch {
      // Не блокируем UI при ошибке подсчёта
    }
  },

  markAsRead: async (notificationId) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId)
      if (error) throw error

      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== notificationId),
        unreadCount: Math.max(0, state.unreadCount - 1),
      }))
    } catch {
      // Молча обрабатываем ошибку
    }
  },

  markAllAsRead: async (userId) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false)
      if (error) throw error

      set({
        notifications: [],
        unreadCount: 0,
      })
    } catch {
      // Молча обрабатываем ошибку
    }
  },
}))
