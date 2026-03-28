import { create } from 'zustand'
import { api } from '@/services/api'
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
      const data = await api.get<Supplier[]>('/api/references/suppliers')
      set({ suppliers: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки'
      set({ error: message, isLoading: false })
    }
  },

  createSupplier: async (data) => {
    set({ isLoading: true, error: null })
    try {
      await api.post('/api/references/suppliers', {
        name: data.name,
        inn: data.inn,
        alternativeNames: data.alternativeNames ?? [],
      })
      await get().fetchSuppliers()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания'
      set({ error: message, isLoading: false })
    }
  },

  updateSupplier: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      await api.put(`/api/references/suppliers/${id}`, {
        name: data.name,
        inn: data.inn,
        alternativeNames: data.alternativeNames,
      })
      await get().fetchSuppliers()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления'
      set({ error: message, isLoading: false })
    }
  },

  deleteSupplier: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await api.delete(`/api/references/suppliers/${id}`)
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
      const batch = rows.slice(i, i + BATCH_SIZE)
      await api.post('/api/references/suppliers/batch-import', { items: batch })
      created += batch.length
      onProgress?.(created, rows.length)
    }
    await get().fetchSuppliers()
    return created
  },

  updateSupplierForImport: async (id, name, alternativeNames) => {
    await api.put(`/api/references/suppliers/${id}`, { name, alternativeNames })
  },
}))
