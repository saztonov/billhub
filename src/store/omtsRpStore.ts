import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import { logError } from '@/services/errorLogger'
import type { OmtsRpSite } from '@/types'
import type { OmtsUser } from '@/store/assignmentStore'

interface OmtsRpStoreState {
  sites: OmtsRpSite[]
  responsibleUserId: string | null
  omtsUsers: OmtsUser[]
  isLoading: boolean
  error: string | null

  fetchSites: () => Promise<void>
  addSite: (constructionSiteId: string) => Promise<void>
  removeSite: (siteId: string) => Promise<void>
  fetchConfig: () => Promise<void>
  updateResponsible: (userId: string | null) => Promise<void>
  fetchOmtsUsers: () => Promise<void>
  isOmtsRpSite: (siteId: string) => boolean
  getResponsibleUserId: () => string | null
}

export const useOmtsRpStore = create<OmtsRpStoreState>((set, get) => ({
  sites: [],
  responsibleUserId: null,
  omtsUsers: [],
  isLoading: false,
  error: null,

  fetchSites: async () => {
    set({ isLoading: true, error: null })
    try {
      // Читаем массив site_ids из settings
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'omts_rp_sites')
        .single()
      if (error) throw error

      const siteIds = ((data.value as Record<string, unknown>).site_ids as string[]) ?? []

      if (siteIds.length === 0) {
        set({ sites: [], isLoading: false })
        return
      }

      // Подгружаем имена объектов
      const { data: sitesData, error: sitesError } = await supabase
        .from('construction_sites')
        .select('id, name')
        .in('id', siteIds)
      if (sitesError) throw sitesError

      const sites: OmtsRpSite[] = (sitesData ?? []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        constructionSiteId: s.id as string,
        createdAt: '',
        siteName: s.name as string,
      }))
      set({ sites, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки объектов ОМТС РП'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchOmtsRpSites' } })
      set({ error: message, isLoading: false })
    }
  },

  addSite: async (constructionSiteId) => {
    set({ error: null })
    try {
      // Читаем текущий массив
      const { data, error: readErr } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'omts_rp_sites')
        .single()
      if (readErr) throw readErr

      const current = ((data.value as Record<string, unknown>).site_ids as string[]) ?? []
      if (current.includes(constructionSiteId)) return

      const updated = [...current, constructionSiteId]

      const { error } = await supabase
        .from('settings')
        .update({ value: { site_ids: updated }, updated_at: new Date().toISOString() })
        .eq('key', 'omts_rp_sites')
      if (error) throw error

      await get().fetchSites()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка добавления объекта'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'addOmtsRpSite' } })
      set({ error: message })
      throw err
    }
  },

  removeSite: async (siteId) => {
    set({ error: null })
    try {
      const { data, error: readErr } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'omts_rp_sites')
        .single()
      if (readErr) throw readErr

      const current = ((data.value as Record<string, unknown>).site_ids as string[]) ?? []
      const updated = current.filter((id) => id !== siteId)

      const { error } = await supabase
        .from('settings')
        .update({ value: { site_ids: updated }, updated_at: new Date().toISOString() })
        .eq('key', 'omts_rp_sites')
      if (error) throw error

      await get().fetchSites()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления объекта'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'removeOmtsRpSite' } })
      set({ error: message })
      throw err
    }
  },

  fetchConfig: async () => {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'omts_rp_config')
        .single()
      if (error) throw error

      const responsibleUserId = (data.value as Record<string, unknown>).responsible_user_id as string | null
      set({ responsibleUserId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки конфигурации ОМТС РП'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchOmtsRpConfig' } })
      set({ error: message })
    }
  },

  updateResponsible: async (userId) => {
    set({ error: null })
    try {
      const { error } = await supabase
        .from('settings')
        .update({ value: { responsible_user_id: userId }, updated_at: new Date().toISOString() })
        .eq('key', 'omts_rp_config')
      if (error) throw error

      set({ responsibleUserId: userId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления ответственного'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'updateOmtsRpResponsible' } })
      set({ error: message })
      throw err
    }
  },

  fetchOmtsUsers: async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name')
        .eq('department_id', 'omts')
        .eq('is_active', true)
        .in('role', ['admin', 'user'])
        .order('full_name', { ascending: true })
      if (error) throw error

      set({
        omtsUsers: (data ?? []).map((u: Record<string, unknown>) => ({
          id: u.id as string,
          email: u.email as string,
          fullName: (u.full_name as string) || (u.email as string),
        })),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки пользователей ОМТС'
      set({ error: message })
    }
  },

  isOmtsRpSite: (siteId) => {
    return get().sites.some((s) => s.constructionSiteId === siteId)
  },

  getResponsibleUserId: () => {
    return get().responsibleUserId
  },
}))
