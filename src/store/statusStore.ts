import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { Status } from '@/types'

interface StatusStoreState {
  statuses: Status[]
  isLoading: boolean
  error: string | null
  fetchStatuses: (entityType: string) => Promise<void>
  createStatus: (data: {
    entity_type: string
    code: string
    name: string
    color?: string
    is_active?: boolean
    display_order?: number
  }) => Promise<void>
  updateStatus: (id: string, data: Record<string, unknown>) => Promise<void>
  deleteStatus: (id: string) => Promise<void>
}

export const useStatusStore = create<StatusStoreState>((set, get) => ({
  statuses: [],
  isLoading: false,
  error: null,

  fetchStatuses: async (entityType) => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('statuses')
        .select('id, entity_type, code, name, color, is_active, display_order, visible_roles, created_at')
        .eq('entity_type', entityType)
        .order('display_order', { ascending: true })
      if (error) throw error
      const statuses: Status[] = (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        entityType: row.entity_type as string,
        code: row.code as string,
        name: row.name as string,
        color: (row.color as string) ?? null,
        isActive: row.is_active as boolean,
        displayOrder: row.display_order as number,
        visibleRoles: (row.visible_roles as string[]) ?? [],
        createdAt: row.created_at as string,
      }))
      set({ statuses, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки статусов'
      set({ error: message, isLoading: false })
    }
  },

  createStatus: async (data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('statuses').insert(data)
      if (error) throw error
      await get().fetchStatuses(data.entity_type)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания статуса'
      set({ error: message, isLoading: false })
    }
  },

  updateStatus: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('statuses').update(data).eq('id', id)
      if (error) throw error
      // Перезагружаем статусы текущей сущности
      const current = get().statuses[0]
      if (current) await get().fetchStatuses(current.entityType)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления статуса'
      set({ error: message, isLoading: false })
    }
  },

  deleteStatus: async (id) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.from('statuses').delete().eq('id', id)
      if (error) throw error
      const current = get().statuses[0]
      if (current) await get().fetchStatuses(current.entityType)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления статуса'
      set({ error: message, isLoading: false })
    }
  },
}))
