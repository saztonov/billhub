import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { User } from '@/types'

interface AuthStoreState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthStoreState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null })
    try {
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({ email, password })
      if (authError) throw authError

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, email, role, counterparty_id, department_id, all_sites, full_name, is_active')
        .eq('id', authData.user.id)
        .single()
      if (userError) throw userError

      // Проверка деактивации
      if (userData.is_active === false) {
        await supabase.auth.signOut()
        set({ user: null, isAuthenticated: false, isLoading: false, error: 'Ваш аккаунт деактивирован' })
        return
      }

      const user: User = {
        id: userData.id,
        email: userData.email,
        fullName: userData.full_name ?? '',
        role: userData.role,
        counterpartyId: userData.counterparty_id,
        department: userData.department_id,
        allSites: userData.all_sites ?? false,
        isActive: userData.is_active ?? true,
      }
      set({ user, isAuthenticated: true, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка авторизации'
      set({ error: message, isLoading: false })
    }
  },

  logout: async () => {
    set({ isLoading: true })
    try {
      await supabase.auth.signOut()
      set({ user: null, isAuthenticated: false, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка выхода'
      set({ error: message, isLoading: false })
    }
  },

  checkAuth: async () => {
    set({ isLoading: true })
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const session = sessionData.session
      if (!session) {
        set({ user: null, isAuthenticated: false, isLoading: false })
        return
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, email, role, counterparty_id, department_id, all_sites, full_name, is_active')
        .eq('id', session.user.id)
        .single()
      if (userError) throw userError

      // Проверка деактивации — разлогиниваем
      if (userData.is_active === false) {
        await supabase.auth.signOut()
        set({ user: null, isAuthenticated: false, isLoading: false })
        return
      }

      const user: User = {
        id: userData.id,
        email: userData.email,
        fullName: userData.full_name ?? '',
        role: userData.role,
        counterpartyId: userData.counterparty_id,
        department: userData.department_id,
        allSites: userData.all_sites ?? false,
        isActive: userData.is_active ?? true,
      }
      set({ user, isAuthenticated: true, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка проверки сессии'
      set({ user: null, isAuthenticated: false, error: message, isLoading: false })
    }
  },

  clearError: () => set({ error: null }),
}))
