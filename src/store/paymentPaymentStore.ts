import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import { logError } from '@/services/errorLogger'
import { deleteFile } from '@/services/s3'
import type { PaymentPayment, PaymentPaymentFile } from '@/types'

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
  removePaymentFile: (fileId: string, fileKey: string) => Promise<void>
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
      const { data, error } = await supabase
        .from('payment_payments')
        .select('id, payment_request_id, payment_number, payment_date, amount, created_by, updated_by, created_at, updated_at, payment_payment_files(id, payment_payment_id, file_name, file_key, file_size, mime_type, created_by, created_at)')
        .eq('payment_request_id', paymentRequestId)
        .order('payment_number', { ascending: true })

      if (error) throw error

      const payments: PaymentPayment[] = (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        paymentRequestId: row.payment_request_id as string,
        paymentNumber: row.payment_number as number,
        paymentDate: row.payment_date as string,
        amount: row.amount as number,
        createdBy: row.created_by as string,
        updatedBy: (row.updated_by as string) ?? null,
        createdAt: row.created_at as string,
        updatedAt: (row.updated_at as string) ?? null,
        files: ((row.payment_payment_files as Record<string, unknown>[]) ?? []).map((f) => ({
          id: f.id as string,
          paymentPaymentId: f.payment_payment_id as string,
          fileName: f.file_name as string,
          fileKey: f.file_key as string,
          fileSize: (f.file_size as number) ?? null,
          mimeType: (f.mime_type as string) ?? null,
          createdBy: f.created_by as string,
          createdAt: f.created_at as string,
        })),
      }))

      set({ payments, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки оплат'
      set({ error: message, isLoading: false })
    }
  },

  createPayment: async (paymentRequestId, data, userId) => {
    set({ isSubmitting: true, error: null })
    try {
      // Определяем следующий номер оплаты
      const { data: maxData } = await supabase
        .from('payment_payments')
        .select('payment_number')
        .eq('payment_request_id', paymentRequestId)
        .order('payment_number', { ascending: false })
        .limit(1)

      const nextNumber = (maxData && maxData.length > 0)
        ? (maxData[0].payment_number as number) + 1
        : 1

      const { data: inserted, error } = await supabase
        .from('payment_payments')
        .insert({
          payment_request_id: paymentRequestId,
          payment_number: nextNumber,
          payment_date: data.paymentDate,
          amount: data.amount,
          created_by: userId,
        })
        .select('id')
        .single()

      if (error) throw error

      await get().recalcPaidStatus(paymentRequestId)
      await get().fetchPayments(paymentRequestId)
      set({ isSubmitting: false })
      return inserted.id as string
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
      const updates: Record<string, unknown> = {
        updated_by: userId,
        updated_at: new Date().toISOString(),
      }
      if (data.paymentDate !== undefined) updates.payment_date = data.paymentDate
      if (data.amount !== undefined) updates.amount = data.amount

      const { error } = await supabase
        .from('payment_payments')
        .update(updates)
        .eq('id', id)
      if (error) throw error

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

      // Удаляем оплату (файлы каскадно удалятся из БД)
      const { error } = await supabase
        .from('payment_payments')
        .delete()
        .eq('id', id)
      if (error) throw error

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
      const { error } = await supabase
        .from('payment_payment_files')
        .insert({
          payment_payment_id: paymentId,
          file_name: fileRecord.fileName,
          file_key: fileRecord.fileKey,
          file_size: fileRecord.fileSize,
          mime_type: fileRecord.mimeType,
          created_by: userId,
        })
      if (error) throw error

      // Перезагружаем оплаты для обновления списка файлов
      const payment = get().payments.find((p) => p.id === paymentId)
      if (payment) await get().fetchPayments(payment.paymentRequestId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка добавления файла оплаты'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'addPaymentFile' } })
      throw err
    }
  },

  removePaymentFile: async (fileId, fileKey) => {
    try {
      // Удаляем из S3
      try { await deleteFile(fileKey) } catch { /* файл мог быть уже удален */ }

      const { error } = await supabase
        .from('payment_payment_files')
        .delete()
        .eq('id', fileId)
      if (error) throw error
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления файла оплаты'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'removePaymentFile' } })
      throw err
    }
  },

  recalcPaidStatus: async (paymentRequestId) => {
    try {
      // Считаем сумму оплат
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payment_payments')
        .select('amount')
        .eq('payment_request_id', paymentRequestId)
      if (paymentsError) throw paymentsError

      const totalPaid = (paymentsData ?? []).reduce((sum, p) => sum + Number(p.amount), 0)

      // Получаем invoice_amount заявки
      const { data: reqData, error: reqError } = await supabase
        .from('payment_requests')
        .select('invoice_amount')
        .eq('id', paymentRequestId)
        .single()
      if (reqError) throw reqError

      const invoiceAmount = Number(reqData.invoice_amount) || 0

      // Определяем код статуса
      let statusCode = 'not_paid'
      if (totalPaid > 0 && totalPaid < invoiceAmount) {
        statusCode = 'partially_paid'
      } else if (totalPaid > 0 && totalPaid >= invoiceAmount) {
        statusCode = 'paid'
      }

      // Получаем id статуса
      const { data: statusData, error: statusError } = await supabase
        .from('statuses')
        .select('id')
        .eq('entity_type', 'paid')
        .eq('code', statusCode)
        .single()
      if (statusError) throw statusError

      // Обновляем заявку
      const { error: updError } = await supabase
        .from('payment_requests')
        .update({
          total_paid: totalPaid,
          paid_status_id: statusData.id,
        })
        .eq('id', paymentRequestId)
      if (updError) throw updError
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка пересчёта статуса оплаты'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'recalcPaidStatus' } })
    }
  },
}))
