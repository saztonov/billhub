import { create } from 'zustand'
import { api } from '@/services/api'
import type { PaymentRequestAssignment } from '@/types'

export interface OmtsUser {
  id: string
  email: string
  fullName: string
}

interface AssignmentStoreState {
  currentAssignment: PaymentRequestAssignment | null
  assignmentHistory: PaymentRequestAssignment[]
  omtsUsers: OmtsUser[]
  isLoading: boolean
  error: string | null

  fetchCurrentAssignment: (paymentRequestId: string) => Promise<void>
  fetchAssignmentHistory: (paymentRequestId: string) => Promise<void>
  fetchOmtsUsers: () => Promise<void>
  assignResponsible: (
    paymentRequestId: string,
    assignedUserId: string,
    assignedByUserId: string,
  ) => Promise<void>
}

export const useAssignmentStore = create<AssignmentStoreState>((set, get) => ({
  currentAssignment: null,
  assignmentHistory: [],
  omtsUsers: [],
  isLoading: false,
  error: null,

  fetchCurrentAssignment: async (paymentRequestId) => {
    try {
      const data = await api.get<PaymentRequestAssignment | null>(
        `/api/assignments/payment-request/${paymentRequestId}/current`,
      )

      set({ currentAssignment: data ?? null })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки назначения'
      set({ error: message })
    }
  },

  fetchAssignmentHistory: async (paymentRequestId) => {
    try {
      const data = await api.get<PaymentRequestAssignment[]>(
        `/api/assignments/payment-request/${paymentRequestId}`,
      )

      set({ assignmentHistory: data ?? [] })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки истории'
      set({ error: message })
    }
  },

  fetchOmtsUsers: async () => {
    try {
      const data = await api.get<OmtsUser[]>('/api/assignments/omts-users')

      set({ omtsUsers: data ?? [] })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки пользователей'
      set({ error: message })
    }
  },

  assignResponsible: async (paymentRequestId, assignedUserId, assignedByUserId) => {
    const prev = get().currentAssignment
    // Оптимистичное обновление — мгновенно отражаем выбор в UI
    const omtsUser = get().omtsUsers.find((u) => u.id === assignedUserId)
    set({
      error: null,
      currentAssignment: {
        id: prev?.id ?? '',
        paymentRequestId,
        assignedUserId,
        assignedByUserId,
        assignedAt: new Date().toISOString(),
        isCurrent: true,
        createdAt: prev?.createdAt ?? new Date().toISOString(),
        assignedUserEmail: omtsUser?.email,
        assignedUserFullName: omtsUser?.fullName,
        assignedByUserEmail: undefined,
      },
    })
    try {
      await api.post('/api/assignments', {
        paymentRequestId,
        assignedUserId,
        assignedByUserId,
      })

      // Синхронизировать с БД и обновить историю
      await get().fetchCurrentAssignment(paymentRequestId)
      await get().fetchAssignmentHistory(paymentRequestId)
    } catch (err) {
      // Откат оптимистичного обновления
      set({ currentAssignment: prev })
      const message = err instanceof Error ? err.message : 'Ошибка назначения'
      set({ error: message })
      throw err
    }
  },
}))
