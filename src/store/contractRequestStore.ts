import { create } from 'zustand'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import type { ContractRequest, ContractRequestFile, RevisionTarget } from '@/types'

interface CreateContractRequestData {
  siteId: string
  counterpartyId: string
  supplierId: string
  partiesCount: number
  subjectType: string
  subjectDetail?: string
  totalFiles: number
}

export interface EditContractRequestData {
  siteId?: string
  counterpartyId?: string
  supplierId?: string
  partiesCount?: number
  subjectType?: string
  subjectDetail?: string | null
}

interface ContractRequestStoreState {
  requests: ContractRequest[]
  currentRequestFiles: ContractRequestFile[]
  isLoading: boolean
  isSubmitting: boolean
  error: string | null
  fetchRequests: (counterpartyId?: string, userSiteIds?: string[], allSites?: boolean, includeDeleted?: boolean) => Promise<void>
  createRequest: (data: CreateContractRequestData, userId: string) => Promise<{ requestId: string; requestNumber: string }>
  updateRequest: (id: string, data: EditContractRequestData, userId: string) => Promise<void>
  deleteRequest: (id: string) => Promise<void>
  fetchRequestFiles: (requestId: string) => Promise<void>
  toggleFileRejection: (fileId: string, userId: string) => Promise<void>
  sendToRevision: (id: string, targets: RevisionTarget[], userId: string) => Promise<void>
  completeRevision: (id: string, target: RevisionTarget, userId: string) => Promise<void>
  approveRequest: (id: string, userId: string) => Promise<void>
  markOriginalReceived: (id: string, userId: string) => Promise<void>
  assignToMe: (id: string) => Promise<void>
  updateContractDetails: (id: string, data: { contractNumber?: string | null; contractSigningDate?: string | null }) => Promise<void>
}

export const useContractRequestStore = create<ContractRequestStoreState>((set, get) => ({
  requests: [],
  currentRequestFiles: [],
  isLoading: false,
  isSubmitting: false,
  error: null,

  fetchRequests: async (counterpartyId?, userSiteIds?, allSites?, includeDeleted?) => {
    set({ isLoading: true, error: null })
    try {
      const params: Record<string, string | number | boolean | undefined> = {}
      if (counterpartyId) params.counterpartyId = counterpartyId
      if (includeDeleted) params.includeDeleted = true
      if (allSites !== undefined) params.allSites = allSites
      if (userSiteIds && userSiteIds.length > 0) params.siteIds = userSiteIds.join(',')

      if (allSites === false && userSiteIds && userSiteIds.length === 0) {
        set({ requests: [], isLoading: false })
        return
      }

      const data = await api.get<ContractRequest[]>('/api/contract-requests', params)

      set({ requests: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок на договор'
      set({ error: message, isLoading: false })
    }
  },

  createRequest: async (data, userId) => {
    set({ isSubmitting: true, error: null })
    try {
      const result = await api.post<{ requestId: string; requestNumber: string }>(
        '/api/contract-requests',
        { ...data, userId },
      )

      set({ isSubmitting: false })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания заявки на договор'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'createContractRequest' } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  updateRequest: async (id, data, userId) => {
    set({ isSubmitting: true, error: null })
    try {
      await api.put(`/api/contract-requests/${id}`, { ...data, userId })

      await get().fetchRequests()
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления заявки'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'updateContractRequest', id } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  deleteRequest: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await api.delete(`/api/contract-requests/${id}`)

      await get().fetchRequests()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления заявки'
      set({ error: message, isLoading: false })
    }
  },

  fetchRequestFiles: async (requestId) => {
    try {
      const data = await api.get<ContractRequestFile[]>(
        `/api/contract-requests/${requestId}/files`,
      )

      set({ currentRequestFiles: data ?? [] })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки файлов'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchContractRequestFiles' } })
    }
  },

  toggleFileRejection: async (fileId, userId) => {
    const files = get().currentRequestFiles
    const file = files.find((f) => f.id === fileId)
    if (!file) return

    const newRejected = !file.isRejected

    try {
      await api.patch(`/api/contract-requests/files/${fileId}/rejection`, {
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
      logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка', errorStack: null, metadata: { action: 'toggleContractFileRejection', fileId } })
    }
  },

  sendToRevision: async (id, targets, userId) => {
    set({ isSubmitting: true, error: null })
    try {
      await api.post(`/api/contract-requests/${id}/revision`, { targets, userId })

      await get().fetchRequests()
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка отправки на доработку'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'sendContractToRevision', id } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  completeRevision: async (id, target, userId) => {
    set({ isSubmitting: true, error: null })
    try {
      await api.post(`/api/contract-requests/${id}/revision-complete`, { target, userId })

      await get().fetchRequests()
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка завершения доработки'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'completeContractRevision', id } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  approveRequest: async (id, userId) => {
    set({ isSubmitting: true, error: null })
    try {
      await api.post(`/api/contract-requests/${id}/approve`, { userId })

      await get().fetchRequests()
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка согласования'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'approveContractRequest', id } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  markOriginalReceived: async (id, userId) => {
    set({ isSubmitting: true, error: null })
    try {
      await api.post(`/api/contract-requests/${id}/original-received`, { userId })

      await get().fetchRequests()
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка подтверждения оригинала'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'markOriginalReceived', id } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  assignToMe: async (id) => {
    set({ isSubmitting: true, error: null })
    try {
      await api.post(`/api/contract-requests/${id}/assign`, {})

      await get().fetchRequests()
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка назначения ответственного'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'assignContractRequest', id } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  updateContractDetails: async (id, data) => {
    const prev = get().requests
    // Оптимистичное обновление
    set({
      requests: prev.map((r) =>
        r.id === id
          ? {
              ...r,
              ...(data.contractNumber !== undefined ? { contractNumber: data.contractNumber } : {}),
              ...(data.contractSigningDate !== undefined ? { contractSigningDate: data.contractSigningDate } : {}),
            }
          : r,
      ),
    })
    try {
      await api.patch(`/api/contract-requests/${id}/contract-details`, data)
    } catch (err) {
      // Откат при ошибке
      set({ requests: prev })
      const message = err instanceof Error ? err.message : 'Ошибка обновления данных договора'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'updateContractDetails', id } })
      throw err
    }
  },
}))
