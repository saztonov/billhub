import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { Counterparty } from '@/types'

interface CounterpartyStoreState {
  counterparties: Counterparty[]
  procurementUsers: { id: string; email: string }[]
  isLoading: boolean
  error: string | null
  fetchCounterparties: () => Promise<void>
  fetchProcurementUsers: () => Promise<void>
  createCounterparty: (data: Partial<Counterparty>) => Promise<void>
  updateCounterparty: (id: string, data: Partial<Counterparty>) => Promise<void>
  deleteCounterparty: (id: string) => Promise<void>
}

export const useCounterpartyStore = create<CounterpartyStoreState>((set, get) => ({
  counterparties: [],
  procurementUsers: [],
  isLoading: false,
  error: null,

  fetchCounterparties: async () => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('counterparties')
        .select('*, responsible_user:users!counterparties_responsible_user_id_fkey(email)')
        .order('created_at', { ascending: false })
      if (error) throw error

      const counterparties: Counterparty[] = (data ?? []).map((row: Record<string, unknown>) => {
        const responsibleUser = row.responsible_user as Record<string, unknown> | null
        return {
          id: row.id as string,
          name: row.name as string,
          inn: row.inn as string,
          address: row.address as string,
          alternativeNames: (row.alternative_names as string[]) ?? [],
          responsibleUserId: (row.responsible_user_id as string) ?? null,
          responsibleUserEmail: (responsibleUser?.email as string) ?? null,
          registrationToken: (row.registration_token as string) ?? null,
          createdAt: row.created_at as string,
        }
      })

      set({ counterparties, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки'
      set({ error: message, isLoading: false })
    }
  },

  fetchProcurementUsers: async () => {
    try {
      // Получаем подразделения с is_procurement = true
      const { data: depts, error: deptError } = await supabase
        .from('departments')
        .select('id')
        .eq('is_procurement', true)
      if (deptError) throw deptError

      const deptIds = (depts ?? []).map((d: Record<string, unknown>) => d.id as string)
      if (deptIds.length === 0) {
        set({ procurementUsers: [] })
        return
      }

      // Получаем пользователей из этих подразделений
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, email')
        .in('department_id', deptIds)
        .in('role', ['admin', 'user'])
      if (usersError) throw usersError

      set({
        procurementUsers: (users ?? []).map((u: Record<string, unknown>) => ({
          id: u.id as string,
          email: u.email as string,
        })),
      })
    } catch {
      // Не блокируем основную логику
    }
  },

  createCounterparty: async (data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('counterparties').insert({
        name: data.name,
        inn: data.inn,
        address: data.address || '',
        alternative_names: data.alternativeNames ?? [],
        responsible_user_id: data.responsibleUserId ?? null,
      })
      if (error) throw error
      await get().fetchCounterparties()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания'
      set({ error: message, isLoading: false })
    }
  },

  updateCounterparty: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase
        .from('counterparties')
        .update({
          name: data.name,
          inn: data.inn,
          address: data.address,
          alternative_names: data.alternativeNames,
          responsible_user_id: data.responsibleUserId ?? null,
        })
        .eq('id', id)
      if (error) throw error

      // Авторезолв уведомлений missing_manager при назначении ответственного
      if (data.responsibleUserId) {
        const { data: prIds } = await supabase
          .from('payment_requests')
          .select('id')
          .eq('counterparty_id', id)

        const prIdList = (prIds ?? []).map((p: Record<string, unknown>) => p.id as string)
        if (prIdList.length > 0) {
          await supabase
            .from('notifications')
            .update({ resolved: true, resolved_at: new Date().toISOString() })
            .eq('type', 'missing_manager')
            .eq('resolved', false)
            .in('payment_request_id', prIdList)
        }
      }

      await get().fetchCounterparties()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления'
      set({ error: message, isLoading: false })
    }
  },

  deleteCounterparty: async (id) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('counterparties').delete().eq('id', id)
      if (error) throw error
      await get().fetchCounterparties()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления'
      set({ error: message, isLoading: false })
    }
  },
}))
