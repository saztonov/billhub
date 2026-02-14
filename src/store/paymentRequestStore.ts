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
  invoiceAmount?: number
}

export interface EditRequestData {
  deliveryDays?: number
  deliveryDaysType?: string
  shippingConditionId?: string
  siteId?: string
  comment?: string
  invoiceAmount?: number | null
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
  incrementUploadedFiles: (requestId: string, isResubmit?: boolean) => void
  fetchRequestFiles: (requestId: string) => Promise<void>
  resubmitRequest: (
    id: string,
    comment: string,
    counterpartyId: string,
    userId: string,
  ) => Promise<void>
  updateRequest: (
    id: string,
    data: EditRequestData,
    userId: string,
    newFilesCount?: number,
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
          shipping:payment_request_field_options!payment_requests_shipping_condition_id_fkey(value),
          current_assignment:payment_request_assignments!left(
            assigned_user_id,
            is_current,
            assigned_user:users!payment_request_assignments_assigned_user_id_fkey(email, full_name)
          )
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

        // Извлекаем текущее назначение (is_current = true)
        const assignments = (row.current_assignment as Record<string, unknown>[]) ?? []
        const currentAssignment = assignments.find(
          (a: Record<string, unknown>) => a.is_current === true
        ) ?? null
        const assignedUser = currentAssignment?.assigned_user as Record<string, unknown> | null

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
          rejectedStage: (row.rejected_stage as number) ?? null,
          resubmitComment: (row.resubmit_comment as string) ?? null,
          resubmitCount: (row.resubmit_count as number) ?? 0,
          invoiceAmount: (row.invoice_amount as number) ?? null,
          counterpartyName: counterparties?.name as string | undefined,
          siteName: site?.name as string | undefined,
          statusName: statuses?.name as string | undefined,
          statusColor: (statuses?.color as string) ?? null,
          shippingConditionValue: shipping?.value as string | undefined,
          assignedUserId: (currentAssignment?.assigned_user_id as string) ?? null,
          assignedUserEmail: (assignedUser?.email as string) ?? null,
          assignedUserFullName: (assignedUser?.full_name as string) ?? null,
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
          invoice_amount: data.invoiceAmount || null,
          total_files: data.totalFiles,
          uploaded_files: 0,
          created_by: userId,
        })
        .select('id')
        .single()
      if (reqError) throw reqError

      // 4. Запускаем жесткую цепочку согласования: Этап 1 - Штаб
      await supabase.from('approval_decisions').insert({
        payment_request_id: requestData.id,
        stage_order: 1,
        department_id: 'shtab',
        status: 'pending',
      })

      // Устанавливаем текущий этап
      await supabase
        .from('payment_requests')
        .update({ current_stage: 1 })
        .eq('id', requestData.id)

      // Проверяем наличие специалистов Штаба для объекта
      await checkAndNotifyMissingSpecialists(requestData.id, data.siteId, 'shtab')

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

  resubmitRequest: async (id, comment, counterpartyId, userId) => {
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

      // 2. Получаем текущее значение resubmit_count, rejected_stage и site_id
      const { data: currentReq, error: reqError } = await supabase
        .from('payment_requests')
        .select('resubmit_count, rejected_stage, site_id')
        .eq('id', id)
        .single()
      if (reqError) throw reqError

      const newCount = ((currentReq.resubmit_count as number) ?? 0) + 1
      const siteId = currentReq.site_id as string
      // Определяем этап для повторной отправки: если была отклонена на ОМТС - идет сразу на ОМТС
      const targetStage = (currentReq.rejected_stage as number) ?? 1

      // 3. Обновляем заявку: сброс статуса, сохранение комментария
      const { error: updError } = await supabase
        .from('payment_requests')
        .update({
          status_id: statusData.id,
          rejected_at: null,
          rejected_stage: null, // Очищаем этап отклонения при повторной отправке
          approved_at: null, // Очищаем дату согласования для нового цикла
          current_stage: targetStage, // Возвращаем на тот этап, где была отклонена
          resubmit_comment: comment || null,
          resubmit_count: newCount,
        })
        .eq('id', id)
      if (updError) throw updError

      // 4. Создаём pending-записи для целевого этапа согласования
      // Используем жесткую цепочку: Этап 1 = Штаб, Этап 2 = ОМТС

      // Определяем department для целевого этапа
      const targetDepartment = targetStage === 1 ? 'shtab' : 'omts'

      // Удаляем только pending записи для целевого этапа
      // После миграции БД: partial unique index позволяет иметь несколько rejected/approved записей,
      // но только одну pending - история согласований сохраняется в таблице
      await supabase
        .from('approval_decisions')
        .delete()
        .eq('payment_request_id', id)
        .eq('stage_order', targetStage)
        .eq('department_id', targetDepartment)
        .eq('status', 'pending')

      // Создаём новую pending-запись для целевого этапа
      await supabase.from('approval_decisions').insert({
        payment_request_id: id,
        stage_order: targetStage,
        department_id: targetDepartment,
        status: 'pending',
      })

      // Проверяем и уведомляем о недостающих специалистах
      await checkAndNotifyMissingSpecialists(id, siteId, targetDepartment)

      // Логируем повторную отправку
      await supabase.from('payment_request_logs').insert({
        payment_request_id: id,
        user_id: userId,
        action: 'resubmit',
        details: {
          comment,
          target_stage: targetStage,
          target_department: targetDepartment,
          resubmit_count: newCount,
        },
      })

      await get().fetchRequests(counterpartyId)
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка повторной отправки'
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  updateRequest: async (id, data, userId, newFilesCount?) => {
    set({ isSubmitting: true, error: null })
    try {
      // Получаем текущие значения для логирования изменений
      const { data: current, error: fetchError } = await supabase
        .from('payment_requests')
        .select('delivery_days, delivery_days_type, shipping_condition_id, site_id, comment, invoice_amount, total_files')
        .eq('id', id)
        .single()
      if (fetchError) throw fetchError

      // Формируем объект обновления и список изменений
      const updates: Record<string, unknown> = {}
      const changes: { field: string; oldValue: unknown; newValue: unknown }[] = []

      if (data.deliveryDays !== undefined && data.deliveryDays !== current.delivery_days) {
        updates.delivery_days = data.deliveryDays
        changes.push({ field: 'delivery_days', oldValue: current.delivery_days, newValue: data.deliveryDays })
      }
      if (data.deliveryDaysType !== undefined && data.deliveryDaysType !== current.delivery_days_type) {
        updates.delivery_days_type = data.deliveryDaysType
        changes.push({ field: 'delivery_days_type', oldValue: current.delivery_days_type, newValue: data.deliveryDaysType })
      }
      if (data.shippingConditionId !== undefined && data.shippingConditionId !== current.shipping_condition_id) {
        updates.shipping_condition_id = data.shippingConditionId
        changes.push({ field: 'shipping_condition_id', oldValue: current.shipping_condition_id, newValue: data.shippingConditionId })
      }
      if (data.siteId !== undefined && data.siteId !== current.site_id) {
        updates.site_id = data.siteId
        changes.push({ field: 'site_id', oldValue: current.site_id, newValue: data.siteId })
      }
      if (data.comment !== undefined && data.comment !== current.comment) {
        updates.comment = data.comment || null
        changes.push({ field: 'comment', oldValue: current.comment, newValue: data.comment || null })
      }
      if (data.invoiceAmount !== undefined && data.invoiceAmount !== current.invoice_amount) {
        updates.invoice_amount = data.invoiceAmount ?? null
        changes.push({ field: 'invoice_amount', oldValue: current.invoice_amount, newValue: data.invoiceAmount ?? null })
      }

      // Обновляем total_files если догружаются файлы
      if (newFilesCount && newFilesCount > 0) {
        updates.total_files = (current.total_files as number ?? 0) + newFilesCount
      }

      // Обновляем заявку если есть изменения
      if (Object.keys(updates).length > 0) {
        const { error: updError } = await supabase
          .from('payment_requests')
          .update(updates)
          .eq('id', id)
        if (updError) throw updError
      }

      // Логируем изменения полей
      if (changes.length > 0) {
        await supabase.from('payment_request_logs').insert({
          payment_request_id: id,
          user_id: userId,
          action: 'edit',
          details: { changes },
        })
      }

      // Логируем догрузку файлов
      if (newFilesCount && newFilesCount > 0) {
        await supabase.from('payment_request_logs').insert({
          payment_request_id: id,
          user_id: userId,
          action: 'file_upload',
          details: { count: newFilesCount },
        })
      }

      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления заявки'
      set({ error: message, isSubmitting: false })
      throw err
    }
  },
}))
