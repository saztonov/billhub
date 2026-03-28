import { create } from 'zustand'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import type { PaymentRequest, PaymentRequestFile } from '@/types'

interface CreateRequestData {
  deliveryDays: number
  deliveryDaysType: string
  shippingConditionId: string
  siteId: string
  comment?: string
  totalFiles: number
  invoiceAmount?: number
  supplierId?: string
}

export interface EditRequestData {
  deliveryDays?: number
  deliveryDaysType?: string
  shippingConditionId?: string
  siteId?: string
  comment?: string
  invoiceAmount?: number | null
  supplierId?: string | null
}

interface PaymentRequestStoreState {
  requests: PaymentRequest[]
  currentRequestFiles: PaymentRequestFile[]
  isLoading: boolean
  isSubmitting: boolean
  error: string | null
  fetchRequests: (counterpartyId?: string, userSiteIds?: string[], allSites?: boolean, includeDeleted?: boolean) => Promise<void>
  createRequest: (
    data: CreateRequestData,
    counterpartyId: string,
    userId: string,
  ) => Promise<{ requestId: string; requestNumber: string }>
  deleteRequest: (id: string) => Promise<void>
  withdrawRequest: (id: string, comment?: string) => Promise<void>
  updateRequestStatus: (id: string, statusId: string) => Promise<void>
  incrementUploadedFiles: (requestId: string, isResubmit?: boolean) => void
  fetchRequestFiles: (requestId: string) => Promise<void>
  resubmitRequest: (
    id: string,
    comment: string,
    counterpartyId: string,
    userId: string,
    fieldUpdates?: {
      deliveryDays: number
      deliveryDaysType: string
      shippingConditionId: string
      invoiceAmount: number
    },
  ) => Promise<void>
  updateRequest: (
    id: string,
    data: EditRequestData,
    userId: string,
    newFilesCount?: number,
  ) => Promise<void>
  toggleFileRejection: (fileId: string, userId: string) => Promise<void>
  updateDpData: (id: string, data: { dpNumber: string; dpDate: string; dpAmount: number; dpFileKey: string; dpFileName: string }) => Promise<void>
}

export const usePaymentRequestStore = create<PaymentRequestStoreState>((set, get) => ({
  requests: [],
  currentRequestFiles: [],
  isLoading: false,
  isSubmitting: false,
  error: null,

  fetchRequests: async (counterpartyId?, userSiteIds?, allSites?, includeDeleted?) => {
    set({ isLoading: true, error: null })
    try {
      // Формируем query-параметры для API
      const params: Record<string, string | number | boolean | undefined> = {}
      if (counterpartyId) params.counterpartyId = counterpartyId
      if (includeDeleted) params.includeDeleted = true
      if (allSites !== undefined) params.allSites = allSites
      if (userSiteIds && userSiteIds.length > 0) params.siteIds = userSiteIds.join(',')
      // Если allSites=false и нет объектов — пустой список
      if (allSites === false && userSiteIds && userSiteIds.length === 0) {
        set({ requests: [], isLoading: false })
        return
      }

      const data = await api.get<PaymentRequest[]>('/api/payment-requests', params)

      set({ requests: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
      set({ error: message, isLoading: false })
    }
  },

  createRequest: async (data, counterpartyId, userId) => {
    set({ isSubmitting: true, error: null })
    try {
      const result = await api.post<{ requestId: string; requestNumber: string }>(
        '/api/payment-requests',
        { ...data, counterpartyId, userId },
      )

      // Файлы загружаются отдельно через uploadQueueStore
      await get().fetchRequests(counterpartyId)
      set({ isSubmitting: false })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания заявки'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'createRequest' } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  deleteRequest: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await api.delete(`/api/payment-requests/${id}`)

      await get().fetchRequests()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления заявки'
      set({ error: message, isLoading: false })
    }
  },

  withdrawRequest: async (id, comment?) => {
    set({ isLoading: true, error: null })
    try {
      await api.post(`/api/payment-requests/${id}/withdraw`, { comment: comment || null })

      await get().fetchRequests()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка отзыва заявки'
      set({ error: message, isLoading: false })
    }
  },

  updateRequestStatus: async (id, statusId) => {
    set({ isLoading: true, error: null })
    try {
      await api.patch(`/api/payment-requests/${id}/status`, { statusId })

      await get().fetchRequests()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка изменения статуса'
      set({ error: message, isLoading: false })
    }
  },

  incrementUploadedFiles: (requestId, isResubmit) => {
    set((state) => ({
      requests: state.requests.map((r) =>
        r.id === requestId
          ? {
              ...r,
              uploadedFiles: r.uploadedFiles + 1,
              // При повторной отправке увеличиваем также totalFiles
              totalFiles: isResubmit ? r.totalFiles + 1 : r.totalFiles,
            }
          : r,
      ),
    }))
  },

  fetchRequestFiles: async (requestId) => {
    set({ isLoading: true, error: null })
    try {
      const data = await api.get<PaymentRequestFile[]>(
        `/api/payment-requests/${requestId}/files`,
      )

      set({ currentRequestFiles: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки файлов'
      set({ error: message, isLoading: false })
    }
  },

  resubmitRequest: async (id, comment, counterpartyId, userId, fieldUpdates?) => {
    set({ isSubmitting: true, error: null })
    try {
      await api.post(`/api/payment-requests/${id}/resubmit`, {
        comment,
        counterpartyId,
        userId,
        fieldUpdates: fieldUpdates || null,
      })

      await get().fetchRequests(counterpartyId)
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка повторной отправки'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'resubmitRequest' } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  updateRequest: async (id, data, userId, newFilesCount?) => {
    set({ isSubmitting: true, error: null })
    try {
      await api.put(`/api/payment-requests/${id}`, {
        ...data,
        userId,
        newFilesCount: newFilesCount || 0,
      })

      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления заявки'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'updateRequest' } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  updateDpData: async (id, data) => {
    set({ isSubmitting: true, error: null })
    try {
      await api.patch(`/api/payment-requests/${id}/dp`, data)

      // Обновляем локальное состояние
      set((state) => ({
        requests: state.requests.map((r) =>
          r.id === id
            ? { ...r, dpNumber: data.dpNumber, dpDate: data.dpDate, dpAmount: data.dpAmount, dpFileKey: data.dpFileKey, dpFileName: data.dpFileName }
            : r,
        ),
        isSubmitting: false,
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка сохранения данных РП'
      logError({ errorType: 'api_error', errorMessage: msg, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'updateDpData' } })
      set({ error: msg, isSubmitting: false })
      throw err
    }
  },

  toggleFileRejection: async (fileId, userId) => {
    const files = get().currentRequestFiles
    const file = files.find((f) => f.id === fileId)
    if (!file) return

    const newRejected = !file.isRejected

    try {
      await api.patch(`/api/payment-requests/files/${fileId}/rejection`, {
        isRejected: newRejected,
        userId,
      })

      set({
        currentRequestFiles: files.map((f) =>
          f.id === fileId
            ? { ...f, isRejected: newRejected, rejectedBy: newRejected ? userId : null, rejectedAt: newRejected ? new Date().toISOString() : null }
            : f,
        ),
      })
    } catch (err) {
      logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка', errorStack: null, metadata: { action: 'toggleFileRejection', fileId } })
    }
  },
}))
