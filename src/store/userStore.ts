import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import { supabaseNoSession } from '@/services/supabaseAdmin'
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

interface UserStoreState {
  users: UserRecord[]
  isLoading: boolean
  error: string | null
  fetchUsers: () => Promise<void>
  createUser: (data: CreateUserData) => Promise<void>
  updateUser: (id: string, data: UpdateUserData) => Promise<void>
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
        .select('id, email, full_name, role, counterparty_id, created_at, counterparties!counterparty_id(name), department_id, all_sites')
        .order('created_at', { ascending: false })
      if (error) throw error

      // Загружаем маппинг пользователей к объектам
      const { data: siteMappings, error: smError } = await supabase
        .from('user_construction_sites_mapping')
        .select('user_id, construction_site_id, construction_sites(name)')
      if (smError) throw smError

      // Группируем маппинги по user_id
      const sitesByUser = new Map<string, { ids: string[]; names: string[] }>()
      for (const mapping of siteMappings ?? []) {
        const row = mapping as Record<string, unknown>
        const userId = row.user_id as string
        const siteId = row.construction_site_id as string
        const siteName = (row.construction_sites as Record<string, unknown> | null)?.name as string ?? ''
        if (!sitesByUser.has(userId)) {
          sitesByUser.set(userId, { ids: [], names: [] })
        }
        const entry = sitesByUser.get(userId)!
        entry.ids.push(siteId)
        entry.names.push(siteName)
      }

      const users: UserRecord[] = (data ?? []).map((row: Record<string, unknown>) => {
        const userId = row.id as string
        const sites = sitesByUser.get(userId)
        return {
          id: userId,
          email: row.email as string,
          fullName: (row.full_name as string) ?? '',
          role: row.role as UserRole,
          counterpartyId: row.counterparty_id as string | null,
          counterpartyName: (row.counterparties as { name: string } | null)?.name ?? null,
          department: (row.department_id as Department | null) ?? null,
          allSites: (row.all_sites as boolean) ?? false,
          siteIds: sites?.ids ?? [],
          siteNames: sites?.names ?? [],
          createdAt: row.created_at as string,
        }
      })
      set({ users, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки пользователей'
      set({ error: message, isLoading: false })
    }
  },

  createUser: async (data) => {
    set({ isLoading: true, error: null })
    try {
      // Создаем пользователя в Supabase Auth через клиент без сессии
      const { data: authData, error: authError } = await supabaseNoSession.auth.signUp({
        email: data.email,
        password: data.password,
      })
      if (authError) throw authError
      if (!authData.user) throw new Error('Не удалось создать пользователя')

      // Создаем запись в таблице users
      const { error: insertError } = await supabase
        .from('users')
        .insert({
          id: authData.user.id,
          email: data.email,
          full_name: data.full_name,
          role: data.role,
          counterparty_id: data.role === 'counterparty_user' ? data.counterparty_id : null,
          department_id: data.department || null,
          all_sites: data.role === 'counterparty_user' ? false : data.all_sites,
        })
      if (insertError) throw insertError

      // Вставляем маппинг объектов
      if (!data.all_sites && data.role !== 'counterparty_user' && data.site_ids.length > 0) {
        const rows = data.site_ids.map((siteId) => ({
          user_id: authData.user!.id,
          construction_site_id: siteId,
        }))
        const { error: siteError } = await supabase
          .from('user_construction_sites_mapping')
          .insert(rows)
        if (siteError) throw siteError
      }

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
      // Обновляем основные поля пользователя
      const { error } = await supabase
        .from('users')
        .update({
          full_name: data.full_name,
          role: data.role,
          counterparty_id: data.role === 'counterparty_user' ? data.counterparty_id : null,
          department_id: data.department,
          all_sites: data.role === 'counterparty_user' ? false : data.all_sites,
        })
        .eq('id', id)
      if (error) throw error

      // Обновляем маппинг объектов
      // Удаляем старые записи
      const { error: delError } = await supabase
        .from('user_construction_sites_mapping')
        .delete()
        .eq('user_id', id)
      if (delError) throw delError

      // Вставляем новые (только если не all_sites и не counterparty_user)
      if (!data.all_sites && data.role !== 'counterparty_user' && data.site_ids.length > 0) {
        const rows = data.site_ids.map((siteId) => ({
          user_id: id,
          construction_site_id: siteId,
        }))
        const { error: insError } = await supabase
          .from('user_construction_sites_mapping')
          .insert(rows)
        if (insError) throw insError
      }

      // Авторезолв уведомлений missing_specialist
      if (data.department && data.role !== 'counterparty_user') {
        const { data: unresolvedNotifs } = await supabase
          .from('notifications')
          .select('id, department_id, site_id')
          .eq('type', 'missing_specialist')
          .eq('resolved', false)
          .eq('department_id', data.department)

        for (const notif of unresolvedNotifs ?? []) {
          const row = notif as Record<string, unknown>
          const notifSiteId = row.site_id as string | null
          // Проверяем совпадение по объекту
          const matchesSite = data.all_sites || (notifSiteId && data.site_ids.includes(notifSiteId))
          if (matchesSite) {
            await supabase
              .from('notifications')
              .update({ resolved: true, resolved_at: new Date().toISOString() })
              .eq('department_id', row.department_id as string)
              .eq('site_id', notifSiteId)
              .eq('type', 'missing_specialist')
              .eq('resolved', false)
          }
        }
      }

      await get().fetchUsers()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления пользователя'
      set({ error: message, isLoading: false })
    }
  },
}))
