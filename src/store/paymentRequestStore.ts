import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import { uploadRequestFile, deleteFile } from '@/services/s3'
import type { PaymentRequest, PaymentRequestFile } from '@/types'

interface CreateRequestData {
  urgencyId: string
  urgencyReason?: string
  deliveryDays: number
  shippingConditionId: string
  comment?: string
  files: Array<{
    file: File
    documentTypeId: string
  }>
}

interface PaymentRequestStoreState {
  requests: PaymentRequest[]
  currentRequestFiles: PaymentRequestFile[]
  isLoading: boolean
  isSubmitting: boolean
  error: string | null
  fetchRequests: (counterpartyId?: string) => Promise<void>
  createRequest: (
    data: CreateRequestData,
    counterpartyId: string,
    counterpartyName: string,
    userId: string,
  ) => Promise<void>
  deleteRequest: (id: string) => Promise<void>
  withdrawRequest: (id: string) => Promise<void>
  updateRequestStatus: (id: string, statusId: string) => Promise<void>
  fetchRequestFiles: (requestId: string) => Promise<void>
}

export const usePaymentRequestStore = create<PaymentRequestStoreState>((set, get) => ({
  requests: [],
  currentRequestFiles: [],
  isLoading: false,
  isSubmitting: false,
  error: null,

  fetchRequests: async (counterpartyId?) => {
    set({ isLoading: true, error: null })
    try {
      let query = supabase
        .from('payment_requests')
        .select(`
          *,
          counterparties(name),
          statuses!payment_requests_status_id_fkey(name, color),
          urgency:payment_request_field_options!payment_requests_urgency_id_fkey(value),
          shipping:payment_request_field_options!payment_requests_shipping_condition_id_fkey(value)
        `)
        .order('created_at', { ascending: false })

      if (counterpartyId) {
        query = query.eq('counterparty_id', counterpartyId)
      }

      const { data, error } = await query
      if (error) throw error

      const requests: PaymentRequest[] = (data ?? []).map((row: Record<string, unknown>) => {
        const counterparties = row.counterparties as Record<string, unknown> | null
        const statuses = row.statuses as Record<string, unknown> | null
        const urgency = row.urgency as Record<string, unknown> | null
        const shipping = row.shipping as Record<string, unknown> | null
        return {
          id: row.id as string,
          requestNumber: row.request_number as string,
          counterpartyId: row.counterparty_id as string,
          statusId: row.status_id as string,
          urgencyId: row.urgency_id as string,
          urgencyReason: row.urgency_reason as string | null,
          deliveryDays: row.delivery_days as number,
          shippingConditionId: row.shipping_condition_id as string,
          comment: row.comment as string | null,
          createdBy: row.created_by as string,
          createdAt: row.created_at as string,
          withdrawnAt: row.withdrawn_at as string | null,
          counterpartyName: counterparties?.name as string | undefined,
          statusName: statuses?.name as string | undefined,
          statusColor: (statuses?.color as string) ?? null,
          urgencyValue: urgency?.value as string | undefined,
          shippingConditionValue: shipping?.value as string | undefined,
        }
      })

      set({ requests, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
      set({ error: message, isLoading: false })
    }
  },

  createRequest: async (data, counterpartyId, counterpartyName, userId) => {
    set({ isSubmitting: true, error: null })
    const uploadedKeys: string[] = []
    try {
      // 1. Получаем id статуса "Отправлена"
      const { data: statusData, error: statusError } = await supabase
        .from('statuses')
        .select('id')
        .eq('entity_type', 'payment_request')
        .eq('code', 'sent')
        .single()
      if (statusError) throw statusError

      // 2. Генерация номера через БД-функцию
      const { data: requestNumber, error: numError } = await supabase
        .rpc('generate_request_number')
      if (numError) throw numError

      // 3. Создание заявки
      const { data: requestData, error: reqError } = await supabase
        .from('payment_requests')
        .insert({
          request_number: requestNumber,
          counterparty_id: counterpartyId,
          status_id: statusData.id,
          urgency_id: data.urgencyId,
          urgency_reason: data.urgencyReason || null,
          delivery_days: data.deliveryDays,
          shipping_condition_id: data.shippingConditionId,
          comment: data.comment || null,
          created_by: userId,
        })
        .select('id')
        .single()
      if (reqError) throw reqError

      // 4. Загрузка файлов в S3 и сохранение метаданных
      for (const fileData of data.files) {
        const { key } = await uploadRequestFile(
          counterpartyName,
          requestNumber as string,
          fileData.file,
        )
        uploadedKeys.push(key)

        const { error: fileError } = await supabase
          .from('payment_request_files')
          .insert({
            payment_request_id: requestData.id,
            document_type_id: fileData.documentTypeId,
            file_name: fileData.file.name,
            file_key: key,
            file_size: fileData.file.size,
            mime_type: fileData.file.type || null,
            created_by: userId,
          })
        if (fileError) throw fileError
      }

      await get().fetchRequests(counterpartyId)
      set({ isSubmitting: false })
    } catch (err) {
      // Откат: удаляем загруженные файлы из S3
      for (const key of uploadedKeys) {
        await deleteFile(key).catch(() => {})
      }
      const message = err instanceof Error ? err.message : 'Ошибка создания заявки'
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  deleteRequest: async (id) => {
    set({ isLoading: true, error: null })
    try {
      // Загружаем файлы заявки для удаления из S3
      const { data: files, error: filesError } = await supabase
        .from('payment_request_files')
        .select('file_key')
        .eq('payment_request_id', id)
      if (filesError) throw filesError

      // Удаляем файлы из S3
      for (const file of files ?? []) {
        await deleteFile(file.file_key).catch(() => {})
      }

      // Удаляем заявку из БД (каскад удалит payment_request_files)
      const { error } = await supabase
        .from('payment_requests')
        .delete()
        .eq('id', id)
      if (error) throw error

      await get().fetchRequests()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления заявки'
      set({ error: message, isLoading: false })
    }
  },

  withdrawRequest: async (id) => {
    set({ isLoading: true, error: null })
    try {
      // Получаем id статуса "Отозвана"
      const { data: statusData, error: statusError } = await supabase
        .from('statuses')
        .select('id')
        .eq('entity_type', 'payment_request')
        .eq('code', 'withdrawn')
        .single()
      if (statusError) throw statusError

      const { error } = await supabase
        .from('payment_requests')
        .update({
          status_id: statusData.id,
          withdrawn_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error

      await get().fetchRequests()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка отзыва заявки'
      set({ error: message, isLoading: false })
    }
  },

  updateRequestStatus: async (id, statusId) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase
        .from('payment_requests')
        .update({ status_id: statusId })
        .eq('id', id)
      if (error) throw error
      await get().fetchRequests()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка изменения статуса'
      set({ error: message, isLoading: false })
    }
  },

  fetchRequestFiles: async (requestId) => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('payment_request_files')
        .select('*, document_types(name)')
        .eq('payment_request_id', requestId)
        .order('created_at', { ascending: true })
      if (error) throw error

      const files: PaymentRequestFile[] = (data ?? []).map(
        (row: Record<string, unknown>) => {
          const dt = row.document_types as Record<string, unknown> | null
          return {
            id: row.id as string,
            paymentRequestId: row.payment_request_id as string,
            documentTypeId: row.document_type_id as string,
            fileName: row.file_name as string,
            fileKey: row.file_key as string,
            fileSize: row.file_size as number | null,
            mimeType: row.mime_type as string | null,
            createdBy: row.created_by as string,
            createdAt: row.created_at as string,
            documentTypeName: dt?.name as string | undefined,
          }
        },
      )

      set({ currentRequestFiles: files, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки файлов'
      set({ error: message, isLoading: false })
    }
  },
}))
