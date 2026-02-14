import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { PaymentRequestAssignment } from '@/types'

interface AssignmentStoreState {
  currentAssignment: PaymentRequestAssignment | null
  assignmentHistory: PaymentRequestAssignment[]
  omtsUsers: { id: string; email: string; fullName: string }[]
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
      const { data, error } = await supabase
        .from('payment_request_assignments')
        .select(`
          *,
          assigned_user:users!payment_request_assignments_assigned_user_id_fkey(email, full_name),
          assigned_by_user:users!payment_request_assignments_assigned_by_user_id_fkey(email)
        `)
        .eq('payment_request_id', paymentRequestId)
        .eq('is_current', true)
        .maybeSingle()

      if (error) throw error

      if (data) {
        const assignedUser = data.assigned_user as { email: string; full_name: string } | null
        const assignedByUser = data.assigned_by_user as { email: string } | null

        set({
          currentAssignment: {
            id: data.id,
            paymentRequestId: data.payment_request_id,
            assignedUserId: data.assigned_user_id,
            assignedByUserId: data.assigned_by_user_id,
            assignedAt: data.assigned_at,
            isCurrent: data.is_current,
            createdAt: data.created_at,
            assignedUserEmail: assignedUser?.email,
            assignedUserFullName: assignedUser?.full_name,
            assignedByUserEmail: assignedByUser?.email,
          },
        })
      } else {
        set({ currentAssignment: null })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки назначения'
      set({ error: message })
    }
  },

  fetchAssignmentHistory: async (paymentRequestId) => {
    try {
      const { data, error } = await supabase
        .from('payment_request_assignments')
        .select(`
          *,
          assigned_user:users!payment_request_assignments_assigned_user_id_fkey(email, full_name),
          assigned_by_user:users!payment_request_assignments_assigned_by_user_id_fkey(email)
        `)
        .eq('payment_request_id', paymentRequestId)
        .order('assigned_at', { ascending: false })

      if (error) throw error

      const history: PaymentRequestAssignment[] = (data ?? []).map((row: any) => ({
        id: row.id,
        paymentRequestId: row.payment_request_id,
        assignedUserId: row.assigned_user_id,
        assignedByUserId: row.assigned_by_user_id,
        assignedAt: row.assigned_at,
        isCurrent: row.is_current,
        createdAt: row.created_at,
        assignedUserEmail: row.assigned_user?.email,
        assignedUserFullName: row.assigned_user?.full_name,
        assignedByUserEmail: row.assigned_by_user?.email,
      }))

      set({ assignmentHistory: history })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки истории'
      set({ error: message })
    }
  },

  fetchOmtsUsers: async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name')
        .eq('department_id', 'omts')
        .in('role', ['admin', 'user'])
        .order('full_name', { ascending: true })

      if (error) throw error

      set({
        omtsUsers: (data ?? []).map((u: any) => ({
          id: u.id,
          email: u.email,
          fullName: u.full_name || u.email,
        })),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки пользователей'
      set({ error: message })
    }
  },

  assignResponsible: async (paymentRequestId, assignedUserId, assignedByUserId) => {
    set({ isLoading: true, error: null })
    try {
      // 1. Пометить текущее назначение как неактуальное
      await supabase
        .from('payment_request_assignments')
        .update({ is_current: false })
        .eq('payment_request_id', paymentRequestId)
        .eq('is_current', true)

      // 2. Создать новое назначение
      const { error } = await supabase
        .from('payment_request_assignments')
        .insert({
          payment_request_id: paymentRequestId,
          assigned_user_id: assignedUserId,
          assigned_by_user_id: assignedByUserId,
          is_current: true,
        })

      if (error) throw error

      // 3. Обновить текущее назначение в store
      await get().fetchCurrentAssignment(paymentRequestId)

      set({ isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка назначения'
      set({ error: message, isLoading: false })
      throw err
    }
  },
}))
