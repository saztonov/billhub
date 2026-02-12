import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { UserRole } from '@/types'

/** Пользователь из таблицы users (с именем контрагента) */
export interface UserRecord {
  id: string
  email: string
  role: UserRole
  counterpartyId: string | null
  counterpartyName: string | null
  createdAt: string
}

interface UserStoreState {
  users: UserRecord[]
  isLoading: boolean
  error: string | null
  fetchUsers: () => Promise<void>
  updateUser: (id: string, data: { role: UserRole; counterparty_id: string | null }) => Promise<void>
}

export const useUserStore = create<UserStoreState>((set, get) => ({
  users: [],
  isLoading: false,
  error: null,

  fetchUsers: async () => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, role, counterparty_id, created_at, counterparties(name)')
        .order('created_at', { ascending: false })
      if (error) throw error

      const users: UserRecord[] = (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        email: row.email as string,
        role: row.role as UserRole,
        counterpartyId: row.counterparty_id as string | null,
        counterpartyName: (row.counterparties as { name: string } | null)?.name ?? null,
        createdAt: row.created_at as string,
      }))
      set({ users, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки пользователей'
      set({ error: message, isLoading: false })
    }
  },

  updateUser: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase
        .from('users')
        .update({
          role: data.role,
          counterparty_id: data.role === 'counterparty_user' ? data.counterparty_id : null,
        })
        .eq('id', id)
      if (error) throw error
      await get().fetchUsers()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления пользователя'
      set({ error: message, isLoading: false })
    }
  },
}))
