import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { Supplier, ImportSupplierRow } from '@/types'

interface SupplierStoreState {
  suppliers: Supplier[]
  isLoading: boolean
  error: string | null
  fetchSuppliers: () => Promise<void>
  createSupplier: (data: Partial<Supplier>) => Promise<void>
  updateSupplier: (id: string, data: Partial<Supplier>) => Promise<void>
  deleteSupplier: (id: string) => Promise<void>
  batchInsertSuppliers: (rows: ImportSupplierRow[], onProgress?: (done: number, total: number) => void) => Promise<number>
  updateSupplierForImport: (id: string, name: string, alternativeNames: string[]) => Promise<void>
}

export const useSupplierStore = create<SupplierStoreState>((set, get) => ({
  suppliers: [],
  isLoading: false,
  error: null,

  fetchSuppliers: async () => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name, inn, alternative_names, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error

      const suppliers: Supplier[] = (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        name: row.name as string,
        inn: row.inn as string,
        alternativeNames: (row.alternative_names as string[]) ?? [],
        createdAt: row.created_at as string,
      }))

      set({ suppliers, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки'
      set({ error: message, isLoading: false })
    }
  },

  createSupplier: async (data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('suppliers').insert({
        name: data.name,
        inn: data.inn,
        alternative_names: data.alternativeNames ?? [],
      })
      if (error) throw error
      await get().fetchSuppliers()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания'
      set({ error: message, isLoading: false })
    }
  },

  updateSupplier: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase
        .from('suppliers')
        .update({
          name: data.name,
          inn: data.inn,
          alternative_names: data.alternativeNames,
        })
        .eq('id', id)
      if (error) throw error
      await get().fetchSuppliers()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления'
      set({ error: message, isLoading: false })
    }
  },

  deleteSupplier: async (id) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('suppliers').delete().eq('id', id)
      if (error) throw error
      await get().fetchSuppliers()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления'
      set({ error: message, isLoading: false })
    }
  },

  batchInsertSuppliers: async (rows, onProgress) => {
    const BATCH_SIZE = 20
    let created = 0
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({
        name: r.name,
        inn: r.inn,
        alternative_names: [],
      }))
      const { error } = await supabase.from('suppliers').insert(batch)
      if (error) throw error
      created += batch.length
      onProgress?.(created, rows.length)
    }
    await get().fetchSuppliers()
    return created
  },

  updateSupplierForImport: async (id, name, alternativeNames) => {
    const { error } = await supabase
      .from('suppliers')
      .update({ name, alternative_names: alternativeNames })
      .eq('id', id)
    if (error) throw error
  },
}))
