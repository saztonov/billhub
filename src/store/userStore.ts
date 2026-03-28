import { create } from 'zustand'
import { api } from '@/services/api'
import type { UserRole, Department } from '@/types'

/** Пользователь из таблицы users (с именем контрагента) */
export interface UserRecord {
  id: string
  email: string
  fullName: string
  role: UserRole
  counterpartyId: string | null
  counterpartyName: string | null
  department: Department | null
  allSites: boolean
  isActive: boolean
  siteIds: string[]
  siteNames: string[]
  createdAt: string
}

interface CreateUserData {
  email: string
  password: string
  full_name: string
  role: UserRole
  counterparty_id: string | null
  department: Department | null
  all_sites: boolean
  site_ids: string[]
}

interface UpdateUserData {
  full_name: string
  role: UserRole
  counterparty_id: string | null
  department: Department | null
  all_sites: boolean
  site_ids: string[]
}

export interface BatchImportUserRow {
  counterpartyId: string
  email: string
  password: string
  fullName: string
}

export interface BatchImportUserResult {
  email: string
  status: 'success' | 'error'
  errorMessage?: string
}

interface UserStoreState {
  users: UserRecord[]
  isLoading: boolean
  error: string | null
  fetchUsers: () => Promise<void>
  createUser: (data: CreateUserData) => Promise<void>
  updateUser: (id: string, data: UpdateUserData) => Promise<void>
  deactivateUser: (id: string) => Promise<void>
  activateUser: (id: string) => Promise<void>
  changePassword: (userId: string, newPassword: string) => Promise<void>
  batchCreateCounterpartyUsers: (
    rows: BatchImportUserRow[],
    onProgress: (done: number, total: number) => void
  ) => Promise<BatchImportUserResult[]>
}

export const useUserStore = create<UserStoreState>((set, get) => ({
  users: [],
  isLoading: false,
  error: null,

  fetchUsers: async () => {
    set({ isLoading: true, error: null })
    try {
      const data = await api.get<UserRecord[]>('/api/users')
      set({ users: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки пользователей'
      set({ error: message, isLoading: false })
    }
  },

  createUser: async (data) => {
    set({ isLoading: true, error: null })
    try {
      // Валидация: для подразделения Штаб обязательно 1-2 объекта
      if (data.department === 'shtab' && !data.all_sites) {
        if (data.site_ids.length === 0) {
          throw new Error('Для подразделения Штаб необходимо выбрать хотя бы один объект')
        }
        if (data.site_ids.length > 2) {
          throw new Error('Для подразделения Штаб можно выбрать не более 2 объектов')
        }
      }

      await api.post('/api/auth/create-user', data)
      await get().fetchUsers()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания пользователя'
      set({ error: message, isLoading: false })
      throw err
    }
  },

  updateUser: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      // Валидация: для подразделения Штаб обязательно 1-2 объекта
      if (data.department === 'shtab' && !data.all_sites) {
        if (data.site_ids.length === 0) {
          throw new Error('Для подразделения Штаб необходимо выбрать хотя бы один объект')
        }
        if (data.site_ids.length > 2) {
          throw new Error('Для подразделения Штаб можно выбрать не более 2 объектов')
        }
      }

      await api.put(`/api/users/${id}`, data)
      await get().fetchUsers()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления пользователя'
      set({ error: message, isLoading: false })
    }
  },

  deactivateUser: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await api.delete(`/api/users/${id}`)
      await get().fetchUsers()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка деактивации пользователя'
      set({ error: message, isLoading: false })
    }
  },

  activateUser: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await api.patch(`/api/users/${id}`, { isActive: true })
      await get().fetchUsers()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка активации пользователя'
      set({ error: message, isLoading: false })
    }
  },

  changePassword: async (userId, newPassword) => {
    await api.post('/api/auth/admin-change-password', { userId, newPassword })
  },

  batchCreateCounterpartyUsers: async (rows, onProgress) => {
    const results: BatchImportUserResult[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      try {
        await api.post('/api/users/batch-import', row)
        results.push({ email: row.email, status: 'success' })
      } catch (err) {
        results.push({
          email: row.email,
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Неизвестная ошибка',
        })
      }

      onProgress(i + 1, rows.length)

      // Пауза между запросами для снижения нагрузки
      if (i < rows.length - 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100))
      }
    }

    await get().fetchUsers()
    return results
  },
}))
