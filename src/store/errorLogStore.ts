import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { ErrorLog, ErrorLogType } from '@/types'

interface ErrorLogFilters {
  errorTypes?: ErrorLogType[]
  dateFrom?: string | null
  dateTo?: string | null
}

interface ErrorLogStoreState {
  logs: ErrorLog[]
  total: number
  isLoading: boolean
  error: string | null
  page: number
  pageSize: number
  filters: ErrorLogFilters
  setPage: (page: number) => void
  setPageSize: (pageSize: number) => void
  setFilters: (filters: ErrorLogFilters) => void
  fetchLogs: () => Promise<void>
  deleteOldLogs: (olderThanDays: number) => Promise<void>
}

export const useErrorLogStore = create<ErrorLogStoreState>((set, get) => ({
  logs: [],
  total: 0,
  isLoading: false,
  error: null,
  page: 1,
  pageSize: 20,
  filters: {},

  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),
  setFilters: (filters) => set({ filters, page: 1 }),

  fetchLogs: async () => {
    set({ isLoading: true, error: null })
    try {
      const { page, pageSize, filters } = get()
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      // Запрос с join на users для получения email
      let query = supabase
        .from('error_logs')
        .select('*, users!error_logs_user_id_fkey(email)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to)

      // Фильтр по типу ошибки
      if (filters.errorTypes && filters.errorTypes.length > 0) {
        query = query.in('error_type', filters.errorTypes)
      }

      // Фильтр по дате
      if (filters.dateFrom) {
        query = query.gte('created_at', filters.dateFrom)
      }
      if (filters.dateTo) {
        query = query.lte('created_at', filters.dateTo + 'T23:59:59.999Z')
      }

      const { data, error, count } = await query
      if (error) throw error

      const logs: ErrorLog[] = (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        createdAt: row.created_at as string,
        errorType: row.error_type as ErrorLogType,
        errorMessage: row.error_message as string,
        errorStack: (row.error_stack as string) ?? null,
        url: (row.url as string) ?? null,
        userId: (row.user_id as string) ?? null,
        userAgent: (row.user_agent as string) ?? null,
        component: (row.component as string) ?? null,
        metadata: (row.metadata as Record<string, unknown>) ?? null,
        userEmail: (row.users as Record<string, unknown> | null)?.email as string | undefined,
      }))

      set({ logs, total: count ?? 0, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки логов'
      set({ error: message, isLoading: false })
    }
  },

  deleteOldLogs: async (olderThanDays) => {
    set({ isLoading: true, error: null })
    try {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

      const { error } = await supabase
        .from('error_logs')
        .delete()
        .lt('created_at', cutoffDate.toISOString())

      if (error) throw error
      await get().fetchLogs()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления логов'
      set({ error: message, isLoading: false })
    }
  },
}))
