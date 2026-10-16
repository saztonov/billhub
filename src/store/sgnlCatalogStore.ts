import { create } from 'zustand'
import { api } from '@/services/api'
import type { SgnlErrorInfo, SgnlProjectOption } from '@/types/sgnl'

interface ProjectsResponse {
  configured: boolean
  ok: boolean
  projects: SgnlProjectOption[]
  error?: SgnlErrorInfo
}

interface SgnlCatalogStoreState {
  projects: SgnlProjectOption[]
  /** Заданы ли SGNL_* на бэкенде */
  configured: boolean
  /** Получен ли список проектов */
  ok: boolean
  error: string | null
  loading: boolean
  loaded: boolean
  fetchProjects: (force?: boolean) => Promise<void>
}

/**
 * Проекты SIGNAL DOCS для сопоставления объектов строительства (только admin).
 * Загружается один раз и кэшируется в памяти.
 */
export const useSgnlCatalogStore = create<SgnlCatalogStoreState>((set, get) => ({
  projects: [],
  configured: false,
  ok: false,
  error: null,
  loading: false,
  loaded: false,

  fetchProjects: async (force = false) => {
    if (get().loading) return
    if (get().loaded && !force) return
    set({ loading: true, error: null })
    try {
      const res = await api.get<ProjectsResponse>('/api/sgnl/projects')
      set({
        projects: res.projects ?? [],
        configured: res.configured,
        ok: res.ok,
        error: res.configured && !res.ok ? (res.error?.message ?? 'SIGNAL недоступен') : null,
        loading: false,
        loaded: true,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки проектов SIGNAL'
      set({ error: message, loading: false, loaded: true, ok: false })
    }
  },
}))
