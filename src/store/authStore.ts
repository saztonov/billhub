import { create } from 'zustand'
import { api, ApiError } from '@/services/api'
import type { User } from '@/types'

/** Ответ API на login и checkAuth */
interface AuthUserResponse {
  user: {
    id: string
    email: string
    fullName: string
    role: User['role']
    counterpartyId: string | null
    department: User['department']
    allSites: boolean
    isActive: boolean
  }
}

interface AuthStoreState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  clearError: () => void
  changeOwnPassword: (currentPassword: string, newPassword: string) => Promise<void>
}

/** Маппинг ответа API в тип User */
function mapResponseToUser(data: AuthUserResponse['user']): User {
  return {
    id: data.id,
    email: data.email,
    fullName: data.fullName,
    role: data.role,
    counterpartyId: data.counterpartyId,
    department: data.department,
    allSites: data.allSites,
    isActive: data.isActive,
  }
}

export const useAuthStore = create<AuthStoreState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null })
    try {
      const response = await api.post<AuthUserResponse>('/api/auth/login', { email, password }, { skipAuthRedirect: true })
      const user = mapResponseToUser(response.user)

      if (!user.isActive) {
        set({ user: null, isAuthenticated: false, isLoading: false, error: 'Ваш аккаунт деактивирован' })
        return
      }

      set({ user, isAuthenticated: true, isLoading: false })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Ошибка авторизации'
      set({ error: message, isLoading: false })
    }
  },

  logout: async () => {
    set({ isLoading: true })
    try {
      await api.post('/api/auth/logout')
    } catch {
      // Очищаем состояние даже при ошибке сети
    } finally {
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },

  checkAuth: async () => {
    set({ isLoading: true })
    try {
      // skipAuthRedirect: не редиректим на логин при 401 — это задача ProtectedRoute
      const response = await api.get<AuthUserResponse>('/api/auth/me', undefined, { skipAuthRedirect: true })
      const user = mapResponseToUser(response.user)

      if (!user.isActive) {
        set({ user: null, isAuthenticated: false, isLoading: false })
        return
      }

      set({ user, isAuthenticated: true, isLoading: false })
    } catch {
      // Любая ошибка (401, сеть и т.д.) — просто сбрасываем состояние без редиректа
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },

  clearError: () => set({ error: null }),

  changeOwnPassword: async (currentPassword: string, newPassword: string) => {
    const state = useAuthStore.getState()
    if (!state.user) throw new Error('Пользователь не авторизован')

    await api.post('/api/auth/change-password', { currentPassword, newPassword })
  },
}))
