import { create } from 'zustand'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import { deleteFile } from '@/services/s3'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import type { PaymentPayment } from '@/types'

interface CreatePaymentData {
  paymentDate: string
  amount: number
}

interface UpdatePaymentData {
  paymentDate?: string
  amount?: number
}

interface PaymentPaymentStoreState {
  payments: PaymentPayment[]
  isLoading: boolean
  isSubmitting: boolean
  error: string | null
  fetchPayments: (paymentRequestId: string) => Promise<void>
  createPayment: (paymentRequestId: string, data: CreatePaymentData, userId: string) => Promise<string>
  updatePayment: (id: string, data: UpdatePaymentData, userId: string) => Promise<void>
  deletePayment: (id: string) => Promise<void>
  addPaymentFile: (paymentId: string, fileRecord: { fileName: string; fileKey: string; fileSize: number | null; mimeType: string | null }, userId: string) => Promise<void>
  removePaymentFile: (fileId: string, fileKey: string, paymentId?: string) => Promise<void>
  recalcPaidStatus: (paymentRequestId: string) => Promise<void>
}

export const usePaymentPaymentStore = create<PaymentPaymentStoreState>((set, get) => ({
  payments: [],
  isLoading: false,
  isSubmitting: false,
  error: null,

  fetchPayments: async (paymentRequestId) => {
    set({ isLoading: true, error: null })
    try {
      const data = await api.get<PaymentPayment[]>(
        `/api/payments/${paymentRequestId}`,
      )

      set({ payments: data ?? [], isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки оплат'
      set({ error: message, isLoading: false })
    }
  },

  createPayment: async (paymentRequestId, data, userId) => {
    set({ isSubmitting: true, error: null })
    try {
      const result = await api.post<{ id: string }>(`/api/payments/${paymentRequestId}`, {
        ...data,
        userId,
      })

      await get().recalcPaidStatus(paymentRequestId)
      await get().fetchPayments(paymentRequestId)
      set({ isSubmitting: false })
      return result.id
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания оплаты'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'createPayment' } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  updatePayment: async (id, data, userId) => {
    set({ isSubmitting: true, error: null })
    try {
      await api.put(`/api/payments/item/${id}`, { ...data, userId })

      // Получаем payment_request_id для пересчета
      const payment = get().payments.find((p) => p.id === id)
      if (payment) {
        await get().recalcPaidStatus(payment.paymentRequestId)
        await get().fetchPayments(payment.paymentRequestId)
      }
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления оплаты'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'updatePayment' } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  deletePayment: async (id) => {
    set({ isSubmitting: true, error: null })
    try {
      const payment = get().payments.find((p) => p.id === id)
      if (!payment) throw new Error('Оплата не найдена')

      // Удаляем файлы из S3
      for (const file of payment.files) {
        try { await deleteFile(file.fileKey) } catch { /* файл мог быть уже удален */ }
      }

      await api.delete(`/api/payments/item/${id}`)

      await get().recalcPaidStatus(payment.paymentRequestId)
      await get().fetchPayments(payment.paymentRequestId)
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления оплаты'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'deletePayment' } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  addPaymentFile: async (paymentId, fileRecord, userId) => {
    try {
      await api.post(`/api/payments/item/${paymentId}/files`, {
        ...fileRecord,
        userId,
      })

      // Пересчитываем total_paid в заявке и перезагружаем оплаты
      const payment = get().payments.find((p) => p.id === paymentId)
      if (payment) {
        await get().recalcPaidStatus(payment.paymentRequestId)
        await get().fetchPayments(payment.paymentRequestId)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка добавления файла оплаты'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'addPaymentFile' } })
      throw err
    }
  },

  removePaymentFile: async (fileId, fileKey, paymentId) => {
    try {
      // Удаляем из S3
      try { await deleteFile(fileKey) } catch { /* файл мог быть уже удален */ }

      await api.delete(`/api/payments/files/${fileId}`)

      // Пересчитываем is_executed и total_paid
      if (paymentId) {
        const payment = get().payments.find((p) => p.id === paymentId)
        if (payment) await get().recalcPaidStatus(payment.paymentRequestId)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления файла оплаты'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'removePaymentFile' } })
      throw err
    }
  },

  recalcPaidStatus: async (paymentRequestId) => {
    try {
      const result = await api.post<{ totalPaid: number; paidStatusId: string }>(
        `/api/payments/${paymentRequestId}/recalc-status`,
      )

      // Обновляем totalPaid в store заявок для мгновенного отображения на списке
      const reqStore = usePaymentRequestStore.getState()
      const updatedRequests = reqStore.requests.map((r) =>
        r.id === paymentRequestId
          ? { ...r, totalPaid: result.totalPaid, paidStatusId: result.paidStatusId }
          : r
      )
      usePaymentRequestStore.setState({ requests: updatedRequests })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка пересчёта статуса оплаты'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'recalcPaidStatus' } })
    }
  },
}))
