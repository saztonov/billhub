import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw-server'
import { useAuthStore } from './authStore'

const BASE = ''

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isInitialized: false,
      error: null,
      accessTokenExpiresAt: null,
    })
  })

  describe('login', () => {
    it('успешный логин активного пользователя устанавливает isAuthenticated=true', async () => {
      server.use(
        http.post(`${BASE}/api/auth/login`, () =>
          HttpResponse.json({
            user: {
              id: 'u1',
              email: 'admin@test.local',
              fullName: 'Иван Тестов',
              role: 'admin',
              counterpartyId: null,
              department: 'omts',
              allSites: true,
              isActive: true,
            },
            accessTokenExpiresAt: Date.now() + 60000,
          }),
        ),
      )

      await useAuthStore.getState().login('admin@test.local', 'pass')
      const s = useAuthStore.getState()

      expect(s.isAuthenticated).toBe(true)
      expect(s.user?.role).toBe('admin')
      expect(s.error).toBeNull()
      expect(s.accessTokenExpiresAt).toBeGreaterThan(Date.now())
    })

    it('деактивированный пользователь не входит и видит сообщение об ошибке', async () => {
      server.use(
        http.post(`${BASE}/api/auth/login`, () =>
          HttpResponse.json({
            user: {
              id: 'u2',
              email: 'banned@test.local',
              fullName: 'Деактив',
              role: 'user',
              counterpartyId: null,
              department: null,
              allSites: false,
              isActive: false,
            },
          }),
        ),
      )

      await useAuthStore.getState().login('banned@test.local', 'pass')
      const s = useAuthStore.getState()

      expect(s.isAuthenticated).toBe(false)
      expect(s.user).toBeNull()
      expect(s.error).toContain('деактивирован')
    })

    it('401 от бэкэнда записывает error в стор без сброса предыдущей сессии', async () => {
      server.use(
        http.post(`${BASE}/api/auth/login`, () =>
          HttpResponse.json({ error: 'Неверный пароль' }, { status: 401 }),
        ),
      )

      await useAuthStore.getState().login('wrong@test.local', 'pass')
      const s = useAuthStore.getState()

      expect(s.isAuthenticated).toBe(false)
      expect(s.error).toBeTruthy()
      expect(s.isLoading).toBe(false)
    })
  })

  describe('logout', () => {
    it('logout очищает состояние', async () => {
      useAuthStore.setState({
        user: { id: '1' } as never,
        isAuthenticated: true,
        accessTokenExpiresAt: Date.now() + 60000,
      })
      server.use(http.post(`${BASE}/api/auth/logout`, () => HttpResponse.json({ ok: true })))

      await useAuthStore.getState().logout()
      const s = useAuthStore.getState()

      expect(s.isAuthenticated).toBe(false)
      expect(s.user).toBeNull()
      expect(s.accessTokenExpiresAt).toBeNull()
    })

    it('logout очищает состояние даже при ошибке сети', async () => {
      useAuthStore.setState({
        user: { id: '1' } as never,
        isAuthenticated: true,
      })
      server.use(http.post(`${BASE}/api/auth/logout`, () => HttpResponse.error()))

      await useAuthStore.getState().logout()
      const s = useAuthStore.getState()

      expect(s.isAuthenticated).toBe(false)
      expect(s.user).toBeNull()
    })
  })

  describe('checkAuth', () => {
    it('успешный checkAuth устанавливает isInitialized=true и isAuthenticated=true', async () => {
      server.use(
        http.get(`${BASE}/api/auth/me`, () =>
          HttpResponse.json({
            user: {
              id: 'u3',
              email: 'cp@test.local',
              fullName: 'Подрядчик',
              role: 'counterparty_user',
              counterpartyId: 'c1',
              department: null,
              allSites: false,
              isActive: true,
            },
            accessTokenExpiresAt: Date.now() + 30000,
          }),
        ),
      )

      await useAuthStore.getState().checkAuth()
      const s = useAuthStore.getState()

      expect(s.isInitialized).toBe(true)
      expect(s.isAuthenticated).toBe(true)
      expect(s.user?.role).toBe('counterparty_user')
      expect(s.user?.counterpartyId).toBe('c1')
    })

    it('401 от /me сбрасывает состояние и ставит isInitialized=true (без redirect)', async () => {
      server.use(http.get(`${BASE}/api/auth/me`, () => new HttpResponse(null, { status: 401 })))

      await useAuthStore.getState().checkAuth()
      const s = useAuthStore.getState()

      expect(s.isInitialized).toBe(true)
      expect(s.isAuthenticated).toBe(false)
      expect(s.user).toBeNull()
    })
  })

  describe('clearError + setAccessTokenExpiresAt', () => {
    it('clearError обнуляет error', () => {
      useAuthStore.setState({ error: 'Что-то' })
      useAuthStore.getState().clearError()
      expect(useAuthStore.getState().error).toBeNull()
    })

    it('setAccessTokenExpiresAt обновляет значение', () => {
      const ts = Date.now() + 5000
      useAuthStore.getState().setAccessTokenExpiresAt(ts)
      expect(useAuthStore.getState().accessTokenExpiresAt).toBe(ts)
    })
  })
})
