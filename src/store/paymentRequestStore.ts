import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import { deleteFile } from '@/services/s3'
import { checkAndNotifyMissingSpecialists } from '@/utils/approvalNotifications'
import type { PaymentRequest, PaymentRequestFile } from '@/types'

interface CreateRequestData {
  deliveryDays: number
  deliveryDaysType: string
  shippingConditionId: string
  siteId: string
  comment?: string
  totalFiles: number
}

interface PaymentRequestStoreState {
  requests: PaymentRequest[]
  currentRequestFiles: PaymentRequestFile[]
  isLoading: boolean
  isSubmitting: boolean
  error: string | null
  fetchRequests: (counterpartyId?: string, userSiteIds?: string[], allSites?: boolean) => Promise<void>
  createRequest: (
    data: CreateRequestData,
    counterpartyId: string,
    userId: string,
  ) => Promise<{ requestId: string; requestNumber: string }>
  deleteRequest: (id: string) => Promise<void>
  withdrawRequest: (id: string, comment?: string) => Promise<void>
  updateRequestStatus: (id: string, statusId: string) => Promise<void>
  incrementUploadedFiles: (requestId: string) => void
  fetchRequestFiles: (requestId: string) => Promise<void>
  resubmitRequest: (
    id: string,
    comment: string,
    counterpartyId: string,
  ) => Promise<void>
}

export const usePaymentRequestStore = create<PaymentRequestStoreState>((set, get) => ({
  requests: [],
  currentRequestFiles: [],
  isLoading: false,
  isSubmitting: false,
  error: null,

  fetchRequests: async (counterpartyId?, userSiteIds?, allSites?) => {
    set({ isLoading: true, error: null })
    try {
      let query = supabase
        .from('payment_requests')
        .select(`
          *,
          counterparties(name),
          construction_sites(name),
          statuses!payment_requests_status_id_fkey(name, color),
          shipping:payment_request_field_options!payment_requests_shipping_condition_id_fkey(value)
        `)
        .order('created_at', { ascending: false })

      if (counterpartyId) {
        query = query.eq('counterparty_id', counterpartyId)
      }

      // Фильтрация по объектам для role=user
      if (allSites === false && userSiteIds && userSiteIds.length > 0) {
        query = query.in('site_id', userSiteIds)
      } else if (allSites === false && userSiteIds && userSiteIds.length === 0) {
        set({ requests: [], isLoading: false })
        return
      }

      const { data, error } = await query
      if (error) throw error

      const requests: PaymentRequest[] = (data ?? []).map((row: Record<string, unknown>) => {
        const counterparties = row.counterparties as Record<string, unknown> | null
        const site = row.construction_sites as Record<string, unknown> | null
        const statuses = row.statuses as Record<string, unknown> | null
        const shipping = row.shipping as Record<string, unknown> | null
        return {
          id: row.id as string,
          requestNumber: row.request_number as string,
          counterpartyId: row.counterparty_id as string,
          siteId: row.site_id as string,
          statusId: row.status_id as string,
          deliveryDays: row.delivery_days as number,
          deliveryDaysType: (row.delivery_days_type as string) ?? 'working',
          shippingConditionId: row.shipping_condition_id as string,
          comment: row.comment as string | null,
          createdBy: row.created_by as string,
          createdAt: row.created_at as string,
          totalFiles: (row.total_files as number) ?? 0,
          uploadedFiles: (row.uploaded_files as number) ?? 0,
          withdrawnAt: row.withdrawn_at as string | null,
          withdrawalComment: row.withdrawal_comment as string | null,
          currentStage: (row.current_stage as number) ?? null,
          approvedAt: row.approved_at as string | null,
          rejectedAt: row.rejected_at as string | null,
          resubmitComment: (row.resubmit_comment as string) ?? null,
          resubmitCount: (row.resubmit_count as number) ?? 0,
          counterpartyName: counterparties?.name as string | undefined,
          siteName: site?.name as string | undefined,
          statusName: statuses?.name as string | undefined,
          statusColor: (statuses?.color as string) ?? null,
          shippingConditionValue: shipping?.value as string | undefined,
        }
      })

      set({ requests, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
      set({ error: message, isLoading: false })
    }
  },

  createRequest: async (data, counterpartyId, userId) => {
    set({ isSubmitting: true, error: null })
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
          site_id: data.siteId,
          status_id: statusData.id,
          delivery_days: data.deliveryDays,
          delivery_days_type: data.deliveryDaysType,
          shipping_condition_id: data.shippingConditionId,
          comment: data.comment || null,
          total_files: data.totalFiles,
          uploaded_files: 0,
          created_by: userId,
        })
        .select('id')
        .single()
      if (reqError) throw reqError

      // 4. Проверяем наличие этапов согласования и запускаем цепочку
      const { data: firstStage } = await supabase
        .from('approval_stages')
        .select('stage_order, department_id')
        .eq('stage_order', 1)
      if (firstStage && firstStage.length > 0) {
        // Создаём pending-записи для подразделений 1 этапа
        const decisions = firstStage.map((s: Record<string, unknown>) => ({
          payment_request_id: requestData.id,
          stage_order: 1,
          department_id: s.department_id as string,
          status: 'pending',
        }))
        await supabase.from('approval_decisions').insert(decisions)
        // Устанавливаем текущий этап
        await supabase
          .from('payment_requests')
          .update({ current_stage: 1 })
          .eq('id', requestData.id)

        // Проверяем наличие специалистов для первого этапа
        await checkAndNotifyMissingSpecialists(
          requestData.id,
          firstStage.map((s: Record<string, unknown>) => ({ department_id: s.department_id as string })),
        )
      }

      // Файлы загружаются отдельно через uploadQueueStore
      await get().fetchRequests(counterpartyId)
      set({ isSubmitting: false })
      return { requestId: requestData.id as string, requestNumber: requestNumber as string }
    } catch (err) {
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

  withdrawRequest: async (id, comment?) => {
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
          withdrawal_comment: comment || null,
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

  incrementUploadedFiles: (requestId) => {
    set((state) => ({
      requests: state.requests.map((r) =>
        r.id === requestId ? { ...r, uploadedFiles: r.uploadedFiles + 1 } : r,
      ),
    }))
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
            pageCount: row.page_count as number | null,
            createdBy: row.created_by as string,
            createdAt: row.created_at as string,
            isResubmit: (row.is_resubmit as boolean) ?? false,
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

  resubmitRequest: async (id, comment, counterpartyId) => {
    set({ isSubmitting: true, error: null })
    try {
      // 1. Получаем id статуса 'sent'
      const { data: statusData, error: statusError } = await supabase
        .from('statuses')
        .select('id')
        .eq('entity_type', 'payment_request')
        .eq('code', 'sent')
        .single()
      if (statusError) throw statusError

      // 2. Получаем текущее значение resubmit_count
      const { data: currentReq, error: reqError } = await supabase
        .from('payment_requests')
        .select('resubmit_count')
        .eq('id', id)
        .single()
      if (reqError) throw reqError

      const newCount = ((currentReq.resubmit_count as number) ?? 0) + 1

      // 3. Обновляем заявку: сброс статуса, сохранение комментария
      const { error: updError } = await supabase
        .from('payment_requests')
        .update({
          status_id: statusData.id,
          rejected_at: null,
          current_stage: 1,
          resubmit_comment: comment || null,
          resubmit_count: newCount,
        })
        .eq('id', id)
      if (updError) throw updError

      // 4. Создаём pending-записи для 1 этапа согласования
      const { data: firstStage } = await supabase
        .from('approval_stages')
        .select('stage_order, department_id')
        .eq('stage_order', 1)
      if (firstStage && firstStage.length > 0) {
        const decisions = firstStage.map((s: Record<string, unknown>) => ({
          payment_request_id: id,
          stage_order: 1,
          department_id: s.department_id as string,
          status: 'pending',
        }))
        await supabase.from('approval_decisions').insert(decisions)

        await checkAndNotifyMissingSpecialists(
          id,
          firstStage.map((s: Record<string, unknown>) => ({ department_id: s.department_id as string })),
        )
      }

      await get().fetchRequests(counterpartyId)
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка повторной отправки'
      set({ error: message, isSubmitting: false })
      throw err
    }
  },
}))
