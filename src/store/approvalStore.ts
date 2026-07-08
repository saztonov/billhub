import { create } from 'zustand'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import { singleFlight } from '@/store/fetchGuard'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import type {
  Department,
  ApprovalDecision,
  PaymentRequest,
  PaymentRequestLog,
  StageHistoryEntry,
} from '@/types'

/** Добавляет запись в stage_history заявки (через API) */
export async function appendStageHistory(
  paymentRequestId: string,
  entry: Omit<StageHistoryEntry, 'at'> & { at?: string },
) {
  await api.post(`/api/approvals/payment-request/${paymentRequestId}/stage-history`, entry)
}

/** Элемент списка файлов для загрузки */
export interface FileItem {
  file: File
  id: string
}

/** Ключи списков вкладок согласования. */
export type ApprovalListKey = 'pending' | 'rp' | 'approved' | 'rejected'

interface ApprovalStoreState {
  // Решения по заявке
  currentDecisions: ApprovalDecision[]

  // Логи действий по заявке
  currentLogs: PaymentRequestLog[]

  // Списки заявок по вкладкам
  pendingRequests: PaymentRequest[]
  approvedRequests: PaymentRequest[]
  rejectedRequests: PaymentRequest[]
  rpPendingRequests: PaymentRequest[]

  // Счётчики для вкладок (независимые от фильтров)
  approvedCount: number
  rejectedCount: number

  /** Спиннер первой загрузки — раздельно по спискам, чтобы вкладки не мигали разом. */
  listLoading: Record<ApprovalListKey, boolean>
  /** Список хотя бы раз загружен — дальше рефетчи тихие, без спиннера. */
  listLoaded: Record<ApprovalListKey, boolean>

  isLoading: boolean
  error: string | null

  // Решения и логи
  fetchDecisions: (paymentRequestId: string) => Promise<void>
  fetchLogs: (paymentRequestId: string) => Promise<void>
  approveRequest: (
    paymentRequestId: string,
    department: Department,
    userId: string,
    comment: string,
  ) => Promise<void>
  rejectRequest: (
    paymentRequestId: string,
    department: Department,
    userId: string,
    comment: string,
    files?: FileItem[],
  ) => Promise<void>

  // На доработку
  sendToRevision: (paymentRequestId: string, comment: string) => Promise<void>
  // Завершение доработки (контрагент)
  completeRevision: (
    paymentRequestId: string,
    fieldUpdates: {
      deliveryDays: number
      deliveryDaysType: string
      shippingConditionId: string
      invoiceAmount: number
      supplierId?: string | null
    },
  ) => Promise<void>

  // Очистка текущих решений/логов
  clearCurrentData: () => void

  // Заявки по вкладкам. Скоупинг по объектам (siteIds/allSites) выполняется
  // на сервере по профилю пользователя — клиент его больше не передаёт.
  fetchPendingRequests: (department: Department, userId: string, isAdmin?: boolean) => Promise<void>
  fetchRpPendingRequests: () => Promise<void>
  fetchApprovedRequests: (showDeleted?: boolean) => Promise<void>
  fetchRejectedRequests: (showDeleted?: boolean) => Promise<void>

  // Счётчики (только count, без загрузки данных)
  fetchApprovedCount: (showDeleted?: boolean) => Promise<void>
  fetchRejectedCount: (showDeleted?: boolean) => Promise<void>
}

// Порядковые номера последних инициированных запросов по спискам: применяем
// только самый свежий ответ (защита от гонки при смене параметров на лету).
const listSeq: Record<ApprovalListKey, number> = { pending: 0, rp: 0, approved: 0, rejected: 0 }

export const useApprovalStore = create<ApprovalStoreState>((set, get) => {
  /** Спиннер только на первой загрузке списка; дальше рефетчи тихие. */
  const startListLoad = (key: ApprovalListKey) => {
    if (!get().listLoaded[key]) {
      set((s) => ({ listLoading: { ...s.listLoading, [key]: true }, error: null }))
    }
  }
  /** Успешное завершение: применяем данные, гасим спиннер, помечаем список загруженным. */
  const finishListLoad = (key: ApprovalListKey, patch: Partial<ApprovalStoreState>) => {
    set((s) => ({
      ...patch,
      listLoading: { ...s.listLoading, [key]: false },
      listLoaded: { ...s.listLoaded, [key]: true },
    }))
  }
  /** Ошибка: гасим спиннер, listLoaded не трогаем — следующая попытка снова со спиннером. */
  const failListLoad = (key: ApprovalListKey, message: string) => {
    set((s) => ({ error: message, listLoading: { ...s.listLoading, [key]: false } }))
  }

  return {
    currentDecisions: [],
    currentLogs: [],
    pendingRequests: [],
    approvedRequests: [],
    rejectedRequests: [],
    rpPendingRequests: [],
    approvedCount: 0,
    rejectedCount: 0,
    listLoading: { pending: false, rp: false, approved: false, rejected: false },
    listLoaded: { pending: false, rp: false, approved: false, rejected: false },
    isLoading: false,
    error: null,

    sendToRevision: async (paymentRequestId, comment) => {
      set({ isLoading: true, error: null })
      try {
        await api.post(`/api/approvals/payment-request/${paymentRequestId}/revision`, { comment })

        set({ isLoading: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка отправки на доработку'
        logError({
          errorType: 'api_error',
          errorMessage: message,
          errorStack: err instanceof Error ? err.stack : null,
          metadata: { action: 'sendToRevision', paymentRequestId },
        })
        set({ error: message, isLoading: false })
        throw err
      }
    },

    completeRevision: async (paymentRequestId, fieldUpdates) => {
      set({ isLoading: true, error: null })
      try {
        await api.post(
          `/api/approvals/payment-request/${paymentRequestId}/revision-complete`,
          fieldUpdates,
        )

        set({ isLoading: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка завершения доработки'
        logError({
          errorType: 'api_error',
          errorMessage: message,
          errorStack: err instanceof Error ? err.stack : null,
          metadata: { action: 'completeRevision', paymentRequestId },
        })
        set({ error: message, isLoading: false })
        throw err
      }
    },

    clearCurrentData: () => {
      set({ currentDecisions: [], currentLogs: [] })
    },

    fetchDecisions: async (paymentRequestId) => {
      try {
        const data = await api.get<ApprovalDecision[]>(
          `/api/approvals/payment-request/${paymentRequestId}`,
        )

        set({ currentDecisions: data ?? [] })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка загрузки решений'
        set({ error: message })
      }
    },

    fetchLogs: async (paymentRequestId) => {
      try {
        const data = await api.get<PaymentRequestLog[]>(
          `/api/approvals/payment-request/${paymentRequestId}/logs`,
        )

        set({ currentLogs: data ?? [] })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка загрузки логов'
        set({ error: message })
      }
    },

    approveRequest: async (paymentRequestId, department, userId, comment) => {
      set({ isLoading: true, error: null })
      try {
        await api.post('/api/approvals/decide', {
          paymentRequestId,
          department,
          userId,
          comment,
          action: 'approve',
        })

        set({ isLoading: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка согласования'
        logError({
          errorType: 'api_error',
          errorMessage: message,
          errorStack: err instanceof Error ? err.stack : null,
          metadata: { action: 'approveRequest', paymentRequestId },
        })
        set({ error: message, isLoading: false })
      }
    },

    rejectRequest: async (paymentRequestId, department, userId, comment, files = []) => {
      set({ isLoading: true, error: null })
      try {
        const result = await api.post<{ decisionId: string; requestNumber: string }>(
          '/api/approvals/decide',
          {
            paymentRequestId,
            department,
            userId,
            comment,
            action: 'reject',
          },
        )

        // Добавляем файлы в очередь загрузки (ленивая загрузка)
        if (files.length > 0 && result?.decisionId) {
          const plainFiles = files.map((f) => f.file)
          useUploadQueueStore
            .getState()
            .addDecisionFilesTask(result.decisionId, result.requestNumber, plainFiles, userId)
        }

        set({ isLoading: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка отклонения'
        logError({
          errorType: 'api_error',
          errorMessage: message,
          errorStack: err instanceof Error ? err.stack : null,
          metadata: { action: 'rejectRequest', paymentRequestId },
        })
        set({ error: message, isLoading: false })
        throw err
      }
    },

    fetchPendingRequests: async (department, userId, isAdmin = false) => {
      const key = `approvals-pending|${department}|${userId}|${isAdmin ? 1 : 0}`
      await singleFlight(key, async () => {
        const seq = ++listSeq.pending
        startListLoad('pending')
        try {
          const params: Record<string, string | number | boolean | undefined> = {
            department,
            userId,
          }
          if (isAdmin) params.isAdmin = true

          const data = await api.get<PaymentRequest[]>('/api/approvals/pending-requests', params)

          if (seq === listSeq.pending) finishListLoad('pending', { pendingRequests: data ?? [] })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
          if (seq === listSeq.pending) failListLoad('pending', message)
        }
      })
    },

    fetchRpPendingRequests: async () => {
      await singleFlight('approvals-rp-pending', async () => {
        const seq = ++listSeq.rp
        startListLoad('rp')
        try {
          const data = await api.get<PaymentRequest[]>('/api/approvals/rp-pending-requests')

          if (seq === listSeq.rp) finishListLoad('rp', { rpPendingRequests: data ?? [] })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок РП'
          logError({
            errorType: 'api_error',
            errorMessage: message,
            errorStack: err instanceof Error ? err.stack : null,
            metadata: { action: 'fetchRpPendingRequests' },
          })
          if (seq === listSeq.rp) failListLoad('rp', message)
        }
      })
    },

    fetchApprovedRequests: async (showDeleted?) => {
      const key = `approvals-approved|${showDeleted ? 1 : 0}`
      await singleFlight(key, async () => {
        const seq = ++listSeq.approved
        startListLoad('approved')
        try {
          const params: Record<string, string | number | boolean | undefined> = {}
          if (showDeleted) params.showDeleted = true

          const data = await api.get<PaymentRequest[]>('/api/approvals/approved-requests', params)

          if (seq === listSeq.approved) finishListLoad('approved', { approvedRequests: data ?? [] })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
          if (seq === listSeq.approved) failListLoad('approved', message)
        }
      })
    },

    fetchRejectedRequests: async (showDeleted?) => {
      const key = `approvals-rejected|${showDeleted ? 1 : 0}`
      await singleFlight(key, async () => {
        const seq = ++listSeq.rejected
        startListLoad('rejected')
        try {
          const params: Record<string, string | number | boolean | undefined> = {}
          if (showDeleted) params.showDeleted = true

          const data = await api.get<PaymentRequest[]>('/api/approvals/rejected-requests', params)

          if (seq === listSeq.rejected) finishListLoad('rejected', { rejectedRequests: data ?? [] })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
          if (seq === listSeq.rejected) failListLoad('rejected', message)
        }
      })
    },

    fetchApprovedCount: async (showDeleted?) => {
      const key = `approvals-approved-count|${showDeleted ? 1 : 0}`
      await singleFlight(key, async () => {
        try {
          const params: Record<string, string | number | boolean | undefined> = {}
          if (showDeleted) params.showDeleted = true

          const data = await api.get<{ count: number }>('/api/approvals/approved-count', params)

          set({ approvedCount: data?.count ?? 0 })
        } catch (err) {
          logError({
            errorType: 'api_error',
            errorMessage:
              err instanceof Error ? err.message : 'Ошибка получения счётчика согласованных',
            errorStack: err instanceof Error ? err.stack : null,
            metadata: { action: 'fetchApprovedCount' },
          })
        }
      })
    },

    fetchRejectedCount: async (showDeleted?) => {
      const key = `approvals-rejected-count|${showDeleted ? 1 : 0}`
      await singleFlight(key, async () => {
        try {
          const params: Record<string, string | number | boolean | undefined> = {}
          if (showDeleted) params.showDeleted = true

          const data = await api.get<{ count: number }>('/api/approvals/rejected-count', params)

          set({ rejectedCount: data?.count ?? 0 })
        } catch (err) {
          logError({
            errorType: 'api_error',
            errorMessage:
              err instanceof Error ? err.message : 'Ошибка получения счётчика отклонённых',
            errorStack: err instanceof Error ? err.stack : null,
            metadata: { action: 'fetchRejectedCount' },
          })
        }
      })
    },
  }
})
