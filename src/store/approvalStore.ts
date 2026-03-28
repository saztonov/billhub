import { create } from 'zustand'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import type { Department, ApprovalDecision, PaymentRequest, PaymentRequestLog, StageHistoryEntry } from '@/types'

/** Добавляет запись в stage_history заявки (через API) */
export async function appendStageHistory(paymentRequestId: string, entry: Omit<StageHistoryEntry, 'at'> & { at?: string }) {
  await api.post(`/api/approvals/payment-request/${paymentRequestId}/stage-history`, entry)
}

/** Элемент списка файлов для загрузки */
export interface FileItem {
  file: File
  id: string
}

interface ApprovalStoreState {
  // Решения по заявке
  currentDecisions: ApprovalDecision[]

  // Логи действий по заявке
  currentLogs: PaymentRequestLog[]

  // Списки заявок по вкладкам
  pendingRequests: PaymentRequest[]
  approvedRequests: PaymentRequest[]
  rejectedRequests: PaymentRequest[]
  omtsRpPendingRequests: PaymentRequest[]

  // Счётчики для вкладок (независимые от фильтров)
  approvedCount: number
  rejectedCount: number

  isLoading: boolean
  error: string | null

  // Решения и логи
  fetchDecisions: (paymentRequestId: string) => Promise<void>
  fetchLogs: (paymentRequestId: string) => Promise<void>
  approveRequest: (paymentRequestId: string, department: Department, userId: string, comment: string) => Promise<void>
  rejectRequest: (paymentRequestId: string, department: Department, userId: string, comment: string, files?: FileItem[]) => Promise<void>

  // На доработку
  sendToRevision: (paymentRequestId: string, comment: string) => Promise<void>
  // Завершение доработки (контрагент)
  completeRevision: (paymentRequestId: string, fieldUpdates: {
    deliveryDays: number
    deliveryDaysType: string
    shippingConditionId: string
    invoiceAmount: number
  }) => Promise<void>

  // Очистка текущих решений/логов
  clearCurrentData: () => void

  // Заявки по вкладкам
  fetchPendingRequests: (department: Department, userId: string, isAdmin?: boolean) => Promise<void>
  fetchOmtsRpPendingRequests: () => Promise<void>
  fetchApprovedRequests: (userSiteIds?: string[], allSites?: boolean) => Promise<void>
  fetchRejectedRequests: (userSiteIds?: string[], allSites?: boolean) => Promise<void>

  // Счётчики (только count, без загрузки данных)
  fetchApprovedCount: (userSiteIds?: string[], allSites?: boolean) => Promise<void>
  fetchRejectedCount: (userSiteIds?: string[], allSites?: boolean) => Promise<void>
}

export const useApprovalStore = create<ApprovalStoreState>((set) => ({
  currentDecisions: [],
  currentLogs: [],
  pendingRequests: [],
  approvedRequests: [],
  rejectedRequests: [],
  omtsRpPendingRequests: [],
  approvedCount: 0,
  rejectedCount: 0,
  isLoading: false,
  error: null,

  sendToRevision: async (paymentRequestId, comment) => {
    set({ isLoading: true, error: null })
    try {
      await api.post(`/api/approvals/payment-request/${paymentRequestId}/revision`, { comment })

      set({ isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка отправки на доработку'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'sendToRevision', paymentRequestId } })
      set({ error: message, isLoading: false })
      throw err
    }
  },

  completeRevision: async (paymentRequestId, fieldUpdates) => {
    set({ isLoading: true, error: null })
    try {
      await api.post(`/api/approvals/payment-request/${paymentRequestId}/revision-complete`, fieldUpdates)

      set({ isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка завершения доработки'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'completeRevision', paymentRequestId } })
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
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'approveRequest', paymentRequestId } })
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
        useUploadQueueStore.getState().addDecisionFilesTask(
          result.decisionId,
          result.requestNumber,
          plainFiles,
          userId,
        )
      }

      set({ isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка отклонения'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'rejectRequest', paymentRequestId } })
      set({ error: message, isLoading: false })
      throw err
    }
  },

  fetchPendingRequests: async (department, userId, isAdmin = false) => {
    set({ isLoading: true, error: null })
    try {
      const params: Record<string, string | number | boolean | undefined> = {
        department,
        userId,
      }
      if (isAdmin) params.isAdmin = true

      const data = await api.get<PaymentRequest[]>(
        '/api/approvals/pending-requests',
        params,
      )

      set({ pendingRequests: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
      set({ error: message, isLoading: false })
    }
  },

  fetchOmtsRpPendingRequests: async () => {
    set({ isLoading: true, error: null })
    try {
      const data = await api.get<PaymentRequest[]>(
        '/api/approvals/omts-rp-pending-requests',
      )

      set({ omtsRpPendingRequests: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок ОМТС РП'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchOmtsRpPendingRequests' } })
      set({ error: message, isLoading: false })
    }
  },

  fetchApprovedRequests: async (userSiteIds?, allSites?) => {
    set({ isLoading: true, error: null })
    try {
      if (allSites === false && userSiteIds && userSiteIds.length === 0) {
        set({ approvedRequests: [], isLoading: false })
        return
      }

      const params: Record<string, string | number | boolean | undefined> = {}
      if (allSites !== undefined) params.allSites = allSites
      if (userSiteIds && userSiteIds.length > 0) params.siteIds = userSiteIds.join(',')

      const data = await api.get<PaymentRequest[]>(
        '/api/approvals/approved-requests',
        params,
      )

      set({ approvedRequests: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
      set({ error: message, isLoading: false })
    }
  },

  fetchRejectedRequests: async (userSiteIds?, allSites?) => {
    set({ isLoading: true, error: null })
    try {
      if (allSites === false && userSiteIds && userSiteIds.length === 0) {
        set({ rejectedRequests: [], isLoading: false })
        return
      }

      const params: Record<string, string | number | boolean | undefined> = {}
      if (allSites !== undefined) params.allSites = allSites
      if (userSiteIds && userSiteIds.length > 0) params.siteIds = userSiteIds.join(',')

      const data = await api.get<PaymentRequest[]>(
        '/api/approvals/rejected-requests',
        params,
      )

      set({ rejectedRequests: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
      set({ error: message, isLoading: false })
    }
  },

  fetchApprovedCount: async (userSiteIds?, allSites?) => {
    try {
      if (allSites === false && userSiteIds && userSiteIds.length === 0) {
        set({ approvedCount: 0 })
        return
      }

      const params: Record<string, string | number | boolean | undefined> = {}
      if (allSites !== undefined) params.allSites = allSites
      if (userSiteIds && userSiteIds.length > 0) params.siteIds = userSiteIds.join(',')

      const data = await api.get<{ count: number }>(
        '/api/approvals/approved-count',
        params,
      )

      set({ approvedCount: data?.count ?? 0 })
    } catch (err) {
      logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка получения счётчика согласованных', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchApprovedCount' } })
    }
  },

  fetchRejectedCount: async (userSiteIds?, allSites?) => {
    try {
      if (allSites === false && userSiteIds && userSiteIds.length === 0) {
        set({ rejectedCount: 0 })
        return
      }

      const params: Record<string, string | number | boolean | undefined> = {}
      if (allSites !== undefined) params.allSites = allSites
      if (userSiteIds && userSiteIds.length > 0) params.siteIds = userSiteIds.join(',')

      const data = await api.get<{ count: number }>(
        '/api/approvals/rejected-count',
        params,
      )

      set({ rejectedCount: data?.count ?? 0 })
    } catch (err) {
      logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка получения счётчика отклонённых', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchRejectedCount' } })
    }
  },
}))
