import { create } from 'zustand'
import { api } from '@/services/api'
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

  fetchNotifications: async (_userId) => {
    set({ isLoading: true, error: null })
    try {
      const data = await api.get<AppNotification[]>('/api/notifications')

      set({ notifications: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки уведомлений'
      set({ error: message, isLoading: false })
    }
  },

  fetchUnreadCount: async (_userId) => {
    try {
      const data = await api.get<{ count: number }>('/api/notifications/count')
      set({ unreadCount: data?.count ?? 0 })
    } catch {
      // Не блокируем UI при ошибке подсчёта
    }
  },

  markAsRead: async (notificationId) => {
    try {
      await api.post(`/api/notifications/${notificationId}/mark-read`)

      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== notificationId),
        unreadCount: Math.max(0, state.unreadCount - 1),
      }))
    } catch {
      // Молча обрабатываем ошибку
    }
  },

  markAllAsRead: async (_userId) => {
    try {
      await api.post('/api/notifications/mark-all-read')

      set({
        notifications: [],
        unreadCount: 0,
      })
    } catch {
      // Молча обрабатываем ошибку
    }
  },
}))
