import { create } from 'zustand'
import { api } from '@/services/api'

/** Проект PayHub (нормализованный ответ бэкенда) */
export interface PayHubProjectOption {
  id: number
  code: string | null
  name: string | null
}

/** Заказчик/контрагент PayHub (нормализованный ответ бэкенда) */
export interface PayHubContractorOption {
  id: string
  name: string | null
  inn: string | null
}

interface CatalogError {
  code: string
  httpStatus?: number
  message: string
}

interface ProjectsResponse {
  configured: boolean
  ok: boolean
  projects: PayHubProjectOption[]
  error?: CatalogError
}

interface ContractorsResponse {
  configured: boolean
  ok: boolean
  contractors: PayHubContractorOption[]
  error?: CatalogError
}

interface PayHubCatalogStoreState {
  projects: PayHubProjectOption[]
  contractors: PayHubContractorOption[]
  /** Заданы ли PAYHUB_* на бэкенде */
  configured: boolean
  /** Доступен ли PayHub (оба каталога получены) */
  ok: boolean
  error: string | null
  loading: boolean
  /** Каталог уже загружался — не тянуть повторно без force */
  loaded: boolean
  fetchCatalog: (force?: boolean) => Promise<void>
}

/**
 * Каталоги PayHub (проекты + заказчики) для инлайн-выбора в справочнике объектов.
 * Только для admin: загружается один раз, кэшируется в памяти. Роль user каталоги
 * не запрашивает — показывает снимки, сохранённые в самом объекте.
 */
export const usePayHubCatalogStore = create<PayHubCatalogStoreState>((set, get) => ({
  projects: [],
  contractors: [],
  configured: false,
  ok: false,
  error: null,
  loading: false,
  loaded: false,

  fetchCatalog: async (force = false) => {
    if (get().loading) return
    if (get().loaded && !force) return
    set({ loading: true, error: null })
    try {
      const [projectsRes, contractorsRes] = await Promise.all([
        api.get<ProjectsResponse>('/api/payhub/projects'),
        api.get<ContractorsResponse>('/api/payhub/contractors'),
      ])
      const configured = projectsRes.configured && contractorsRes.configured
      const ok = projectsRes.ok && contractorsRes.ok
      const errMsg = projectsRes.error?.message ?? contractorsRes.error?.message ?? null
      set({
        projects: projectsRes.projects ?? [],
        contractors: contractorsRes.contractors ?? [],
        configured,
        ok,
        error: configured && !ok ? errMsg : null,
        loading: false,
        loaded: true,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки каталогов PayHub'
      set({ error: message, loading: false, loaded: true, ok: false })
    }
  },
}))
