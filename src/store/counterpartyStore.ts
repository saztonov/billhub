import { create } from 'zustand'
import { api } from '@/services/api'
import { isFresh, REFERENCE_TTL_MS, singleFlight } from '@/store/fetchGuard'
import type { Counterparty } from '@/types'

export interface ImportCounterpartyRow {
  name: string
  inn: string
}

export interface ImportResult {
  created: number
  updated: number
  skipped: number
}

interface CounterpartyStoreState {
  counterparties: Counterparty[]
  isLoading: boolean
  error: string | null
  /** TTL-кэш: при свежих данных сеть не дёргается; force — принудительный рефетч. */
  fetchCounterparties: (force?: boolean) => Promise<void>
  createCounterparty: (data: Partial<Counterparty>) => Promise<void>
  updateCounterparty: (id: string, data: Partial<Counterparty>) => Promise<void>
  deleteCounterparty: (id: string) => Promise<void>
  batchInsertCounterparties: (
    rows: ImportCounterpartyRow[],
    onProgress?: (done: number, total: number) => void,
  ) => Promise<number>
  updateCounterpartyForImport: (
    id: string,
    name: string,
    alternativeNames: string[],
  ) => Promise<void>
  createCounterpartiesForImport: (
    rows: ImportCounterpartyRow[],
  ) => Promise<{ inn: string; id: string }[]>
}

// Момент последней успешной загрузки справочника (TTL-кэш)
let counterpartiesFetchedAt: number | null = null

export const useCounterpartyStore = create<CounterpartyStoreState>((set, get) => ({
  counterparties: [],
  isLoading: false,
  error: null,

  fetchCounterparties: async (force = false) => {
    if (!force && isFresh(counterpartiesFetchedAt, REFERENCE_TTL_MS)) return
    await singleFlight('references-counterparties', async () => {
      // Спиннер только на первой загрузке
      if (counterpartiesFetchedAt === null) set({ isLoading: true, error: null })
      try {
        const data = await api.get<Counterparty[]>('/api/references/counterparties')
        counterpartiesFetchedAt = Date.now()
        set({ counterparties: data ?? [], isLoading: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка загрузки'
        set({ error: message, isLoading: false })
      }
    })
  },

  createCounterparty: async (data) => {
    set({ isLoading: true, error: null })
    try {
      await api.post('/api/references/counterparties', {
        name: data.name,
        inn: data.inn,
        address: data.address || '',
        alternativeNames: data.alternativeNames ?? [],
      })
      await get().fetchCounterparties(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания'
      set({ error: message, isLoading: false })
    }
  },

  updateCounterparty: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      await api.put(`/api/references/counterparties/${id}`, {
        name: data.name,
        inn: data.inn,
        address: data.address,
        alternativeNames: data.alternativeNames,
      })
      await get().fetchCounterparties(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления'
      set({ error: message, isLoading: false })
    }
  },

  deleteCounterparty: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await api.delete(`/api/references/counterparties/${id}`)
      await get().fetchCounterparties(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления'
      set({ error: message, isLoading: false })
    }
  },

  batchInsertCounterparties: async (rows, onProgress) => {
    const BATCH_SIZE = 20
    let created = 0
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      await api.post('/api/references/counterparties/batch-import', { items: batch })
      created += batch.length
      onProgress?.(created, rows.length)
    }
    await get().fetchCounterparties(true)
    return created
  },

  updateCounterpartyForImport: async (id, name, alternativeNames) => {
    await api.put(`/api/references/counterparties/${id}`, { name, alternativeNames })
  },

  createCounterpartiesForImport: async (rows) => {
    const result = await api.post<{ inn: string; id: string }[]>(
      '/api/references/counterparties/batch-import',
      { items: rows },
    )
    return result ?? []
  },
}))
