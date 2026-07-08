import { create } from 'zustand'
import { api } from '@/services/api'
import { isFresh, REFERENCE_TTL_MS, singleFlight } from '@/store/fetchGuard'
import type { ConstructionSite } from '@/types'

interface ConstructionSiteStoreState {
  sites: ConstructionSite[]
  isLoading: boolean
  error: string | null
  /** TTL-кэш: при свежих данных сеть не дёргается; force — принудительный рефетч. */
  fetchSites: (force?: boolean) => Promise<void>
  createSite: (data: Partial<ConstructionSite>) => Promise<void>
  /** Обновляет объект; возвращает true при успехе. Мержит ответ в sites без полного refetch. */
  updateSite: (id: string, data: Partial<ConstructionSite>) => Promise<boolean>
  deleteSite: (id: string) => Promise<void>
}

/** Поля, которые можно передавать в PUT (undefined отбрасывается JSON, null — очищает сопоставление) */
const UPDATABLE_KEYS = [
  'name',
  'isActive',
  'payhubProjectId',
  'payhubProjectCode',
  'payhubProjectName',
  'payhubContractorId',
  'payhubContractorName',
  'payhubContractorInn',
] as const

function buildUpdateBody(data: Partial<ConstructionSite>): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const key of UPDATABLE_KEYS) {
    if (data[key] !== undefined) body[key] = data[key]
  }
  return body
}

// Момент последней успешной загрузки справочника (TTL-кэш)
let sitesFetchedAt: number | null = null

export const useConstructionSiteStore = create<ConstructionSiteStoreState>((set, get) => ({
  sites: [],
  isLoading: false,
  error: null,

  fetchSites: async (force = false) => {
    if (!force && isFresh(sitesFetchedAt, REFERENCE_TTL_MS)) return
    await singleFlight('references-construction-sites', async () => {
      // Спиннер только на первой загрузке
      if (sitesFetchedAt === null) set({ isLoading: true, error: null })
      try {
        const data = await api.get<ConstructionSite[]>('/api/references/construction-sites')
        sitesFetchedAt = Date.now()
        set({ sites: data ?? [], isLoading: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка загрузки объектов'
        set({ error: message, isLoading: false })
      }
    })
  },

  createSite: async (data) => {
    set({ isLoading: true, error: null })
    try {
      await api.post('/api/references/construction-sites', {
        name: data.name,
        isActive: data.isActive ?? true,
      })
      await get().fetchSites(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания объекта'
      set({ error: message, isLoading: false })
    }
  },

  updateSite: async (id, data) => {
    set({ error: null })
    try {
      const updated = await api.put<ConstructionSite>(
        `/api/references/construction-sites/${id}`,
        buildUpdateBody(data),
      )
      // Мержим обновлённую строку локально — инлайн-правка не мигает всей таблицей
      set((state) => ({ sites: state.sites.map((s) => (s.id === id ? updated : s)) }))
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления объекта'
      set({ error: message })
      return false
    }
  },

  deleteSite: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await api.delete(`/api/references/construction-sites/${id}`)
      await get().fetchSites(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления объекта'
      set({ error: message, isLoading: false })
    }
  },
}))
