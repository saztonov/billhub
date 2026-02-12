import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { Counterparty } from '@/types'

interface CounterpartyStoreState {
  counterparties: Counterparty[]
  isLoading: boolean
  error: string | null
  fetchCounterparties: () => Promise<void>
  createCounterparty: (data: Partial<Counterparty>) => Promise<void>
  updateCounterparty: (id: string, data: Partial<Counterparty>) => Promise<void>
  deleteCounterparty: (id: string) => Promise<void>
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
      set({ counterparties: data as Counterparty[], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки'
      set({ error: message, isLoading: false })
    }
  },

  createCounterparty: async (data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('counterparties').insert(data)
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
      const { error } = await supabase.from('counterparties').update(data).eq('id', id)
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
}))
