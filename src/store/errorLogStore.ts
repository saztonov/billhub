import { create } from 'zustand'
import { api } from '@/services/api'
import type { ErrorLog, ErrorLogType } from '@/types'

interface ErrorLogFilters {
  errorTypes?: ErrorLogType[]
  dateFrom?: string | null
  dateTo?: string | null
}

/** Ответ API со списком логов и общим количеством */
interface ErrorLogResponse {
  data: ErrorLog[]
  total: number
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
  pageSize: 100,
  filters: {},

  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),
  setFilters: (filters) => set({ filters, page: 1 }),

  fetchLogs: async () => {
    set({ isLoading: true, error: null })
    try {
      const { page, pageSize, filters } = get()

      // Формируем параметры запроса
      const params: Record<string, string | number | boolean | undefined> = {
        page,
        pageSize,
      }

      if (filters.errorTypes && filters.errorTypes.length > 0) {
        params.errorTypes = filters.errorTypes.join(',')
      }
      if (filters.dateFrom) {
        params.dateFrom = filters.dateFrom
      }
      if (filters.dateTo) {
        params.dateTo = filters.dateTo
      }

      const result = await api.get<ErrorLogResponse>('/api/error-logs', params)
      set({ logs: result.data ?? [], total: result.total ?? 0, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки логов'
      set({ error: message, isLoading: false })
    }
  },

  deleteOldLogs: async (olderThanDays) => {
    set({ isLoading: true, error: null })
    try {
      await api.delete(`/api/error-logs/bulk?days=${olderThanDays}`)
      await get().fetchLogs()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления логов'
      set({ error: message, isLoading: false })
    }
  },
}))
