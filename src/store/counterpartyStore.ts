import { create } from 'zustand'
import { supabase } from '@/services/supabase'
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
  fetchCounterparties: () => Promise<void>
  createCounterparty: (data: Partial<Counterparty>) => Promise<void>
  updateCounterparty: (id: string, data: Partial<Counterparty>) => Promise<void>
  deleteCounterparty: (id: string) => Promise<void>
  batchInsertCounterparties: (rows: ImportCounterpartyRow[], onProgress?: (done: number, total: number) => void) => Promise<number>
  updateCounterpartyForImport: (id: string, name: string, alternativeNames: string[]) => Promise<void>
}

export const useCounterpartyStore = create<CounterpartyStoreState>((set, get) => ({
  counterparties: [],
  isLoading: false,
  error: null,

  fetchCounterparties: async () => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('counterparties')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error

      const counterparties: Counterparty[] = (data ?? []).map((row: Record<string, unknown>) => {
        return {
          id: row.id as string,
          name: row.name as string,
          inn: row.inn as string,
          address: row.address as string,
          alternativeNames: (row.alternative_names as string[]) ?? [],
          registrationToken: (row.registration_token as string) ?? null,
          createdAt: row.created_at as string,
        }
      })

      set({ counterparties, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки'
      set({ error: message, isLoading: false })
    }
  },

  createCounterparty: async (data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('counterparties').insert({
        name: data.name,
        inn: data.inn,
        address: data.address || '',
        alternative_names: data.alternativeNames ?? [],
      })
      if (error) throw error
      await get().fetchCounterparties()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания'
      set({ error: message, isLoading: false })
    }
  },

  updateCounterparty: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase
        .from('counterparties')
        .update({
          name: data.name,
          inn: data.inn,
          address: data.address,
          alternative_names: data.alternativeNames,
        })
        .eq('id', id)
      if (error) throw error

      await get().fetchCounterparties()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления'
      set({ error: message, isLoading: false })
    }
  },

  deleteCounterparty: async (id) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('counterparties').delete().eq('id', id)
      if (error) throw error
      await get().fetchCounterparties()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления'
      set({ error: message, isLoading: false })
    }
  },

  batchInsertCounterparties: async (rows, onProgress) => {
    const BATCH_SIZE = 20
    let created = 0
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({
        name: r.name,
        inn: r.inn,
        address: '',
        alternative_names: [],
      }))
      const { error } = await supabase.from('counterparties').insert(batch)
      if (error) throw error
      created += batch.length
      onProgress?.(created, rows.length)
    }
    await get().fetchCounterparties()
    return created
  },

  updateCounterpartyForImport: async (id, name, alternativeNames) => {
    const { error } = await supabase
      .from('counterparties')
      .update({ name, alternative_names: alternativeNames })
      .eq('id', id)
    if (error) throw error
  },
}))
