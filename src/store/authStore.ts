import { create } from 'zustand'
import { api, ApiError, setRefreshSuccessHandler } from '@/services/api'
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
  /** Время истечения access_token в миллисекундах (unix ms) */
  accessTokenExpiresAt?: number
}

/** Режим аутентификации (из GET /api/auth/config). keycloak → вход/выход через редирект. */
export type AuthMode = 'standalone' | 'keycloak' | 'supabase-bridge'

interface AuthConfigResponse {
  mode: AuthMode
  loginUrl?: string
  accountUrl?: string
}

interface AuthStoreState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  /** Признак завершения первичной проверки сессии после старта приложения */
  isInitialized: boolean
  error: string | null
  /** Время истечения access_token (unix ms) — для проактивного refresh */
  accessTokenExpiresAt: number | null
  /** Режим аутентификации (rollback-safe: фронт следует за флипом AUTH_MODE без пересборки). */
  authMode: AuthMode
  /** URL Keycloak Account Console (смена пароля/профиль) — в keycloak-режиме. */
  accountUrl: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  loadAuthConfig: () => Promise<void>
  clearError: () => void
  changeOwnPassword: (currentPassword: string, newPassword: string) => Promise<void>
  setAccessTokenExpiresAt: (expiresAt: number | null) => void
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
  isInitialized: false,
  error: null,
  accessTokenExpiresAt: null,
  authMode: 'standalone',
  accountUrl: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null })
    try {
      const response = await api.post<AuthUserResponse>(
        '/api/auth/login',
        { email, password },
        { skipAuthRedirect: true },
      )
      const user = mapResponseToUser(response.user)

      if (!user.isActive) {
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: 'Ваш аккаунт деактивирован',
          accessTokenExpiresAt: null,
        })
        return
      }

      set({
        user,
        isAuthenticated: true,
        isLoading: false,
        accessTokenExpiresAt: response.accessTokenExpiresAt ?? null,
      })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Ошибка авторизации'
      set({ error: message, isLoading: false })
    }
  },

  logout: async () => {
    set({ isLoading: true })
    let logoutUrl: string | undefined
    try {
      // keycloak-режим возвращает { logoutUrl } для top-level end-session Keycloak.
      const res = await api.post<{ success?: boolean; logoutUrl?: string }>('/api/auth/logout')
      logoutUrl = res?.logoutUrl
    } catch {
      // Очищаем состояние даже при ошибке сети
    }
    set({ user: null, isAuthenticated: false, isLoading: false, accessTokenExpiresAt: null })
    // Полноэкранная навигация на Keycloak (гасит SSO-сессию). Только top-level, не fetch.
    if (logoutUrl) window.location.assign(logoutUrl)
  },

  checkAuth: async () => {
    set({ isLoading: true })
    try {
      // skipAuthRedirect: не редиректим на логин при 401 — это задача ProtectedRoute
      const response = await api.get<AuthUserResponse>('/api/auth/me', undefined, {
        skipAuthRedirect: true,
      })
      const user = mapResponseToUser(response.user)

      if (!user.isActive) {
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
          accessTokenExpiresAt: null,
        })
        return
      }

      set({
        user,
        isAuthenticated: true,
        isLoading: false,
        isInitialized: true,
        accessTokenExpiresAt: response.accessTokenExpiresAt ?? null,
      })
    } catch {
      // Любая ошибка (401, сеть и т.д.) — просто сбрасываем состояние без редиректа
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        isInitialized: true,
        accessTokenExpiresAt: null,
      })
    }
  },

  loadAuthConfig: async () => {
    try {
      // /api/auth/config существует только в keycloak-режиме; 404/ошибка → non-keycloak.
      const res = await api.get<AuthConfigResponse>('/api/auth/config', undefined, {
        skipAuthRedirect: true,
      })
      set({ authMode: res.mode, accountUrl: res.accountUrl ?? null })
    } catch {
      set({ authMode: 'standalone', accountUrl: null })
    }
  },

  clearError: () => set({ error: null }),

  changeOwnPassword: async (currentPassword: string, newPassword: string) => {
    const state = useAuthStore.getState()
    if (!state.user) throw new Error('Пользователь не авторизован')

    await api.post('/api/auth/change-password', { currentPassword, newPassword })
  },

  setAccessTokenExpiresAt: (expiresAt) => set({ accessTokenExpiresAt: expiresAt }),
}))

/**
 * Регистрируем обработчик: когда apiFetch успешно обновил токен по 401,
 * он сам знает новое время истечения — обновляем его в сторе,
 * чтобы проактивный таймер видел актуальное значение.
 */
setRefreshSuccessHandler((accessTokenExpiresAt) => {
  useAuthStore.getState().setAccessTokenExpiresAt(accessTokenExpiresAt)
})
