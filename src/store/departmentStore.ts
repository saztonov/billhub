import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { Department } from '@/types'

interface DepartmentStoreState {
  departments: Department[]
  isLoading: boolean
  error: string | null
  fetchDepartments: () => Promise<void>
  createDepartment: (data: Partial<Department>) => Promise<void>
  updateDepartment: (id: string, data: Partial<Department>) => Promise<void>
  deleteDepartment: (id: string) => Promise<void>
}

export const useDepartmentStore = create<DepartmentStoreState>((set, get) => ({
  departments: [],
  isLoading: false,
  error: null,

  fetchDepartments: async () => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error

      const departments: Department[] = (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        name: row.name as string,
        description: row.description as string,
        isActive: row.is_active as boolean,
        createdAt: row.created_at as string,
      }))

      set({ departments, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки подразделений'
      set({ error: message, isLoading: false })
    }
  },

  createDepartment: async (data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('departments').insert({
        name: data.name,
        description: data.description || '',
        is_active: data.isActive ?? true,
      })
      if (error) throw error
      await get().fetchDepartments()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания подразделения'
      set({ error: message, isLoading: false })
    }
  },

  updateDepartment: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase
        .from('departments')
        .update({
          name: data.name,
          description: data.description,
          is_active: data.isActive,
        })
        .eq('id', id)
      if (error) throw error
      await get().fetchDepartments()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления подразделения'
      set({ error: message, isLoading: false })
    }
  },

  deleteDepartment: async (id) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('departments').delete().eq('id', id)
      if (error) throw error
      await get().fetchDepartments()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления подразделения'
      set({ error: message, isLoading: false })
    }
  },
}))
