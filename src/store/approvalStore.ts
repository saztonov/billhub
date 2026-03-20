import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import { logError } from '@/services/errorLogger'
import { checkAndNotifyMissingSpecialists, notifyStatusChanged } from '@/utils/notificationService'
import { triggerOcrIfEnabled } from '@/services/ocrService'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import { useOmtsRpStore } from '@/store/omtsRpStore'
import type { Department, ApprovalDecision, ApprovalDecisionFile, PaymentRequest, PaymentRequestLog, StageHistoryEntry } from '@/types'

/** Получает email и full_name текущего пользователя */
async function getCurrentUserInfo(): Promise<{ email?: string; fullName?: string }> {
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return {}
  const { data } = await supabase
    .from('users')
    .select('email, full_name')
    .eq('id', authUser.id)
    .single()
  return { email: data?.email ?? authUser.email ?? undefined, fullName: (data?.full_name as string) ?? undefined }
}

/** Добавляет запись в stage_history заявки */
export async function appendStageHistory(paymentRequestId: string, entry: Omit<StageHistoryEntry, 'at'> & { at?: string }) {
  const { data, error: fetchErr } = await supabase
    .from('payment_requests')
    .select('stage_history')
    .eq('id', paymentRequestId)
    .single()
  if (fetchErr) throw fetchErr

  const history = (data.stage_history as StageHistoryEntry[]) ?? []
  history.push({ ...entry, at: entry.at ?? new Date().toISOString() } as StageHistoryEntry)

  const { error: updErr } = await supabase
    .from('payment_requests')
    .update({ stage_history: history })
    .eq('id', paymentRequestId)
  if (updErr) throw updErr
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

/** Маппинг строки payment_requests из БД в PaymentRequest */
function mapRequest(row: Record<string, unknown>): PaymentRequest {
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
    invoiceAmountHistory: (row.invoice_amount_history as { amount: number; changedAt: string }[]) ?? [],
    previousStatusId: (row.previous_status_id as string) ?? null,
    stageHistory: (row.stage_history as PaymentRequest['stageHistory']) ?? [],
    isDeleted: (row.is_deleted as boolean) ?? false,
    deletedAt: (row.deleted_at as string) ?? null,
    paidStatusId: (row.paid_status_id as string) ?? null,
    totalPaid: (row.total_paid as number) ?? 0,
    supplierId: (row.supplier_id as string) ?? null,
    counterpartyName: counterparties?.name as string | undefined,
    siteName: site?.name as string | undefined,
    statusName: statuses?.name as string | undefined,
    statusColor: (statuses?.color as string) ?? null,
    shippingConditionValue: shipping?.value as string | undefined,
    assignedUserId: (currentAssignment?.assigned_user_id as string) ?? null,
    assignedUserEmail: (assignedUser?.email as string) ?? null,
    assignedUserFullName: (assignedUser?.full_name as string) ?? null,
    dpNumber: (row.dp_number as string) ?? null,
    dpDate: (row.dp_date as string) ?? null,
    dpAmount: (row.dp_amount as number) ?? null,
    dpFileKey: (row.dp_file_key as string) ?? null,
    dpFileName: (row.dp_file_name as string) ?? null,
    omtsEnteredAt: (row.omts_entered_at as string) ?? null,
    omtsApprovedAt: (row.omts_approved_at as string) ?? null,
    costTypeId: (row.cost_type_id as string) ?? null,
  }
}

/** Общий select для payment_requests с join-ами */
const PR_SELECT = `
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
`

/** Получить объекты пользователя */
async function getUserSiteIds(userId: string): Promise<{ allSites: boolean; siteIds: string[] }> {
  const { data: userData } = await supabase
    .from('users')
    .select('all_sites')
    .eq('id', userId)
    .single()
  const allSites = (userData?.all_sites as boolean) ?? false

  if (allSites) return { allSites: true, siteIds: [] }

  const { data: siteMappings } = await supabase
    .from('user_construction_sites_mapping')
    .select('construction_site_id')
    .eq('user_id', userId)

  const siteIds = (siteMappings ?? []).map((s: Record<string, unknown>) => s.construction_site_id as string)
  return { allSites: false, siteIds }
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
      // Получаем статус "На доработку"
      const { data: statusData, error: stError } = await supabase
        .from('statuses')
        .select('id')
        .eq('entity_type', 'payment_request')
        .eq('code', 'revision')
        .single()
      if (stError) throw stError

      // Получаем текущий статус и этап заявки для сохранения
      const { data: currentReq, error: reqError } = await supabase
        .from('payment_requests')
        .select('status_id, current_stage, approved_at')
        .eq('id', paymentRequestId)
        .single()
      if (reqError) throw reqError

      // Меняем статус заявки и сохраняем предыдущий (current_stage и pending decision остаются)
      // Если заявка была согласована — очищаем approved_at, чтобы она пропала из вкладки "Согласовано"
      const updateData: Record<string, unknown> = { status_id: statusData.id, previous_status_id: currentReq.status_id }
      if (currentReq.approved_at) {
        updateData.approved_at = null
      }
      const { error: updError } = await supabase
        .from('payment_requests')
        .update(updateData)
        .eq('id', paymentRequestId)
      if (updError) throw updError

      // Логируем действие
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const userInfo = await getCurrentUserInfo()
        await supabase.from('payment_request_logs').insert({
          payment_request_id: paymentRequestId,
          user_id: user.id,
          action: 'revision',
          details: comment ? { comment } : null,
        })

        // Записываем в хронологию
        await appendStageHistory(paymentRequestId, {
          stage: (currentReq.current_stage as number) ?? 2,
          department: 'omts',
          event: 'revision',
          userEmail: userInfo.email,
          userFullName: userInfo.fullName,
          comment: comment || undefined,
        })

        // Уведомляем контрагента об отправке на доработку
        notifyStatusChanged(paymentRequestId, 'На доработке', user.id).catch(() => {})
      }

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
      // Получаем заявку с предыдущим статусом и текущей суммой
      const { data: currentReq, error: reqError } = await supabase
        .from('payment_requests')
        .select('previous_status_id, current_stage, invoice_amount, invoice_amount_history')
        .eq('id', paymentRequestId)
        .single()
      if (reqError) throw reqError
      if (!currentReq.previous_status_id) throw new Error('Нет предыдущего статуса для восстановления')

      // Проверяем, был ли предыдущий статус "Согласовано" — если да, восстанавливаем approved_at
      const { data: prevStatus } = await supabase
        .from('statuses')
        .select('code')
        .eq('id', currentReq.previous_status_id as string)
        .single()
      const wasApproved = prevStatus?.code === 'approved'

      // Формируем данные обновления
      const updateData: Record<string, unknown> = {
        status_id: currentReq.previous_status_id,
        previous_status_id: null,
        delivery_days: fieldUpdates.deliveryDays,
        delivery_days_type: fieldUpdates.deliveryDaysType,
        shipping_condition_id: fieldUpdates.shippingConditionId,
        invoice_amount: fieldUpdates.invoiceAmount,
      }

      // Восстанавливаем approved_at для согласованных заявок
      if (wasApproved) {
        updateData.approved_at = new Date().toISOString()
      }

      // Если сумма изменилась — записываем старую в историю
      if (currentReq.invoice_amount != null && currentReq.invoice_amount !== fieldUpdates.invoiceAmount) {
        const history = (currentReq.invoice_amount_history as { amount: number; changedAt: string }[]) ?? []
        history.push({
          amount: currentReq.invoice_amount as number,
          changedAt: new Date().toISOString(),
        })
        updateData.invoice_amount_history = history
      }

      const { error: updError } = await supabase
        .from('payment_requests')
        .update(updateData)
        .eq('id', paymentRequestId)
      if (updError) throw updError

      // Логируем действие
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const userInfo = await getCurrentUserInfo()
        await supabase.from('payment_request_logs').insert({
          payment_request_id: paymentRequestId,
          user_id: user.id,
          action: 'revision_complete',
          details: null,
        })

        // Записываем в хронологию
        await appendStageHistory(paymentRequestId, {
          stage: (currentReq.current_stage as number) ?? 2,
          department: 'omts',
          event: 'revision_complete',
          userEmail: userInfo.email,
          userFullName: userInfo.fullName,
        })

        // Уведомляем сотрудников о завершении доработки
        notifyStatusChanged(paymentRequestId, 'Доработано', user.id).catch(() => {})
      }

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
      const { data, error } = await supabase
        .from('approval_decisions')
        .select('*, users(email, full_name)')
        .eq('payment_request_id', paymentRequestId)
        .order('stage_order', { ascending: true })
      if (error) throw error

      const decisions: ApprovalDecision[] = await Promise.all(
        (data ?? []).map(async (row: Record<string, unknown>) => {
          const usr = row.users as Record<string, unknown> | null

          // Загружаем файлы для этого решения
          const { data: filesData } = await supabase
            .from('approval_decision_files')
            .select('id, approval_decision_id, file_name, file_key, file_size, mime_type, created_by, created_at')
            .eq('approval_decision_id', row.id as string)
            .order('created_at', { ascending: true })

          const files: ApprovalDecisionFile[] = (filesData ?? []).map((f: Record<string, unknown>) => ({
            id: f.id as string,
            approvalDecisionId: f.approval_decision_id as string,
            fileName: f.file_name as string,
            fileKey: f.file_key as string,
            fileSize: f.file_size as number | null,
            mimeType: f.mime_type as string | null,
            createdBy: f.created_by as string,
            createdAt: f.created_at as string,
          }))

          return {
            id: row.id as string,
            paymentRequestId: row.payment_request_id as string,
            stageOrder: row.stage_order as number,
            department: row.department_id as Department,
            status: row.status as ApprovalDecision['status'],
            userId: row.user_id as string | null,
            comment: row.comment as string,
            decidedAt: row.decided_at as string | null,
            createdAt: row.created_at as string,
            userEmail: usr?.email as string | undefined,
            userFullName: usr?.full_name as string | undefined,
            files: files.length > 0 ? files : undefined,
            isOmtsRp: (row.is_omts_rp as boolean) ?? false,
          }
        })
      )
      set({ currentDecisions: decisions })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки решений'
      set({ error: message })
    }
  },

  fetchLogs: async (paymentRequestId) => {
    try {
      const { data, error } = await supabase
        .from('payment_request_logs')
        .select('*, users(email, full_name)')
        .eq('payment_request_id', paymentRequestId)
        .order('created_at', { ascending: true })
      if (error) throw error

      const logs: PaymentRequestLog[] = (data ?? []).map((row: Record<string, unknown>) => {
        const usr = row.users as Record<string, unknown> | null
        return {
          id: row.id as string,
          paymentRequestId: row.payment_request_id as string,
          userId: row.user_id as string,
          action: row.action as string,
          details: row.details as Record<string, unknown> | null,
          createdAt: row.created_at as string,
          userEmail: usr?.email as string | undefined,
          userFullName: usr?.full_name as string | undefined,
        }
      })
      set({ currentLogs: logs })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки логов'
      set({ error: message })
    }
  },

  approveRequest: async (paymentRequestId, department, userId, comment) => {
    set({ isLoading: true, error: null })
    try {
      // 1. Получаем текущий этап заявки
      const { data: pr, error: prError } = await supabase
        .from('payment_requests')
        .select('current_stage, site_id, withdrawn_at')
        .eq('id', paymentRequestId)
        .single()
      if (prError) throw prError
      if (pr.withdrawn_at) throw new Error('Невозможно согласовать отозванную заявку')
      const currentStage = pr.current_stage as number
      const siteId = pr.site_id as string

      // 2. Находим текущее pending-решение (нужно знать is_omts_rp)
      const { data: pendingDecision, error: pendingErr } = await supabase
        .from('approval_decisions')
        .select('id, is_omts_rp')
        .eq('payment_request_id', paymentRequestId)
        .eq('stage_order', currentStage)
        .eq('department_id', department)
        .eq('status', 'pending')
        .single()
      if (pendingErr) throw pendingErr

      // 3. Обновляем решение
      const { error: updError } = await supabase
        .from('approval_decisions')
        .update({
          status: 'approved',
          user_id: userId,
          comment,
          decided_at: new Date().toISOString(),
        })
        .eq('id', pendingDecision.id)
      if (updError) throw updError

      // Получаем данные пользователя для хронологии
      const userInfo = await getCurrentUserInfo()
      const isCurrentOmtsRp = pendingDecision.is_omts_rp as boolean

      // Записываем согласование в хронологию
      await appendStageHistory(paymentRequestId, {
        stage: currentStage,
        department,
        event: 'approved',
        userEmail: userInfo.email,
        userFullName: userInfo.fullName,
        ...(isCurrentOmtsRp ? { isOmtsRp: true } : {}),
      })

      // 4. ЛОГИКА ПЕРЕХОДА МЕЖДУ ЭТАПАМИ
      if (currentStage === 1) {
        // Этап 1 (Штаб) согласован → переходим на Этап 2 (ОМТС)
        await supabase.from('approval_decisions').insert({
          payment_request_id: paymentRequestId,
          stage_order: 2,
          department_id: 'omts',
          status: 'pending',
          is_omts_rp: false,
        })

        // Записываем получение на этап 2
        await appendStageHistory(paymentRequestId, { stage: 2, department: 'omts', event: 'received' })

        // Получаем статус "Согласование ОМТС"
        const { data: omtsStatusData, error: omtsStError } = await supabase
          .from('statuses')
          .select('id')
          .eq('entity_type', 'payment_request')
          .eq('code', 'approv_omts')
          .single()
        if (omtsStError) throw omtsStError

        await supabase
          .from('payment_requests')
          .update({ current_stage: 2, status_id: omtsStatusData.id, omts_entered_at: new Date().toISOString() })
          .eq('id', paymentRequestId)

        // Проверяем специалистов ОМТС для объекта
        await checkAndNotifyMissingSpecialists(paymentRequestId, siteId, 'omts')

      } else if (currentStage === 2) {
        const isCurrentDecisionOmtsRp = pendingDecision.is_omts_rp as boolean

        // Проверяем, нужно ли двойное согласование ОМТС РП
        const omtsRpStore = useOmtsRpStore.getState()
        const needsOmtsRp = omtsRpStore.isOmtsRpSite(siteId)

        if (!isCurrentDecisionOmtsRp && needsOmtsRp) {
          // Обычное ОМТС согласовано, но объект требует ОМТС РП → создаём pending для спец. лица
          await supabase.from('approval_decisions').insert({
            payment_request_id: paymentRequestId,
            stage_order: 2,
            department_id: 'omts',
            status: 'pending',
            is_omts_rp: true,
          })

          // Записываем получение на этап ОМТС РП
          await appendStageHistory(paymentRequestId, { stage: 2, department: 'omts', event: 'received', isOmtsRp: true })

          // Меняем статус на "Согласование ОМТС РП"
          const { data: omtsRpStatusData, error: omtsRpStError } = await supabase
            .from('statuses')
            .select('id')
            .eq('entity_type', 'payment_request')
            .eq('code', 'approv_omts_rp')
            .single()
          if (omtsRpStError) throw omtsRpStError

          await supabase
            .from('payment_requests')
            .update({ status_id: omtsRpStatusData.id, omts_approved_at: new Date().toISOString() })
            .eq('id', paymentRequestId)
        } else {
          // Стандартная логика: ОМТС РП согласовано (или объект не требует ОМТС РП) → Согласована
          const { data: statusData, error: stError } = await supabase
            .from('statuses')
            .select('id')
            .eq('entity_type', 'payment_request')
            .eq('code', 'approved')
            .single()
          if (stError) throw stError

          await supabase
            .from('payment_requests')
            .update({
              status_id: statusData.id,
              current_stage: null,
              approved_at: new Date().toISOString(),
              omts_approved_at: new Date().toISOString(),
            })
            .eq('id', paymentRequestId)

          // Уведомляем контрагента о финальном согласовании
          notifyStatusChanged(paymentRequestId, 'Согласована', userId).catch(() => {})

          // Запускаем OCR-распознавание (неблокирующий вызов)
          triggerOcrIfEnabled(paymentRequestId).catch(() => {})
        }
      }

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
      // 1. Получаем текущий этап и номер заявки
      const { data: pr, error: prError } = await supabase
        .from('payment_requests')
        .select('current_stage, request_number, withdrawn_at')
        .eq('id', paymentRequestId)
        .single()
      if (prError) throw prError
      if (pr.withdrawn_at) throw new Error('Невозможно отклонить отозванную заявку')

      // 2. Обновляем решение
      const { data: decisionData, error: updError } = await supabase
        .from('approval_decisions')
        .update({
          status: 'rejected',
          user_id: userId,
          comment,
          decided_at: new Date().toISOString(),
        })
        .eq('payment_request_id', paymentRequestId)
        .eq('stage_order', pr.current_stage)
        .eq('department_id', department)
        .eq('status', 'pending')
        .select('id')
        .single()
      if (updError) throw updError

      const decisionId = decisionData.id

      // 3. Добавляем файлы в очередь загрузки (ленивая загрузка)
      if (files.length > 0) {
        const plainFiles = files.map((f) => f.file)
        useUploadQueueStore.getState().addDecisionFilesTask(
          decisionId,
          pr.request_number,
          plainFiles,
          userId,
        )
      }

      // 4. Устанавливаем статус Отклонена
      const { data: statusData, error: stError } = await supabase
        .from('statuses')
        .select('id')
        .eq('entity_type', 'payment_request')
        .eq('code', 'rejected')
        .single()
      if (stError) throw stError

      await supabase
        .from('payment_requests')
        .update({
          status_id: statusData.id,
          rejected_stage: pr.current_stage, // Сохраняем этап отклонения перед обнулением
          current_stage: null,
          rejected_at: new Date().toISOString(),
        })
        .eq('id', paymentRequestId)

      // Записываем отклонение в хронологию
      const rejectUserInfo = await getCurrentUserInfo()
      await appendStageHistory(paymentRequestId, {
        stage: pr.current_stage as number,
        department,
        event: 'rejected',
        userEmail: rejectUserInfo.email,
        userFullName: rejectUserInfo.fullName,
        comment: comment || undefined,
      })

      // Уведомляем контрагента об отклонении
      notifyStatusChanged(paymentRequestId, 'Отклонена', userId).catch(() => {})

      set({ isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка отклонения'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'rejectRequest', paymentRequestId } })
      set({ error: message, isLoading: false })
      throw err // Пробрасываем ошибку для обработки в UI
    }
  },

  fetchPendingRequests: async (department, userId, isAdmin = false) => {
    set({ isLoading: true, error: null })
    try {
      // Получаем настройки объектов пользователя
      const { allSites, siteIds: userSiteIds } = await getUserSiteIds(userId)

      // Находим id заявок, ожидающих решения этого подразделения
      // Для ОМТС: обычные сотрудники видят только is_omts_rp=false,
      // специальное лицо ОМТС РП видит все pending
      let decisionsQuery = supabase
        .from('approval_decisions')
        .select('payment_request_id')
        .eq('department_id', department)
        .eq('status', 'pending')

      if (department === 'omts' && !isAdmin) {
        const omtsRpResponsible = useOmtsRpStore.getState().getResponsibleUserId()
        if (userId !== omtsRpResponsible) {
          // Обычный ОМТС — не видит заявки, ожидающие ОМТС РП
          decisionsQuery = decisionsQuery.eq('is_omts_rp', false)
        }
      }

      const { data: decisions, error: decError } = await decisionsQuery
      if (decError) throw decError

      const requestIds = [...new Set((decisions ?? []).map((d: Record<string, unknown>) => d.payment_request_id as string))]
      if (requestIds.length === 0) {
        set({ pendingRequests: [], isLoading: false })
        return
      }

      // ВАЖНО: Для Штаба фильтрация по объектам пользователя обязательна!
      // Если нет назначенных объектов и не all_sites — пустой список
      if (!allSites && userSiteIds.length === 0) {
        set({ pendingRequests: [], isLoading: false })
        return
      }

      let query = supabase
        .from('payment_requests')
        .select(PR_SELECT)
        .in('id', requestIds)
        .eq('is_deleted', false)
        .is('withdrawn_at', null)
        .order('created_at', { ascending: false })

      // Фильтрация по объектам (работает для Штаба и ОМТС)
      if (!allSites) {
        query = query.in('site_id', userSiteIds)
      }

      const { data, error } = await query
      if (error) throw error

      let filteredRequests = (data ?? []).map(mapRequest)

      // Для ОМТС — дополнительная фильтрация по назначенному ответственному
      // Показываем заявки, назначенные текущему пользователю + не назначенные никому
      // Для админа фильтрация не применяется (админ видит все заявки этапа)
      if (department === 'omts' && !isAdmin) {
        filteredRequests = filteredRequests.filter((r) => {
          // Показываем заявку если она назначена пользователю или не назначена никому
          return r.assignedUserId === userId || r.assignedUserId === null
        })
      }

      set({ pendingRequests: filteredRequests, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
      set({ error: message, isLoading: false })
    }
  },

  fetchOmtsRpPendingRequests: async () => {
    set({ isLoading: true, error: null })
    try {
      // Находим заявки с pending решением ОМТС РП
      const { data: decisions, error: decError } = await supabase
        .from('approval_decisions')
        .select('payment_request_id')
        .eq('is_omts_rp', true)
        .eq('status', 'pending')
      if (decError) throw decError

      const requestIds = [...new Set((decisions ?? []).map((d: Record<string, unknown>) => d.payment_request_id as string))]
      if (requestIds.length === 0) {
        set({ omtsRpPendingRequests: [], isLoading: false })
        return
      }

      const { data, error } = await supabase
        .from('payment_requests')
        .select(PR_SELECT)
        .in('id', requestIds)
        .eq('is_deleted', false)
        .is('withdrawn_at', null)
        .order('created_at', { ascending: false })
      if (error) throw error

      set({ omtsRpPendingRequests: (data ?? []).map(mapRequest), isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок ОМТС РП'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchOmtsRpPendingRequests' } })
      set({ error: message, isLoading: false })
    }
  },

  fetchApprovedRequests: async (userSiteIds?, allSites?) => {
    set({ isLoading: true, error: null })
    try {
      let query = supabase
        .from('payment_requests')
        .select(PR_SELECT)
        .not('approved_at', 'is', null)
        .eq('is_deleted', false)
        .order('approved_at', { ascending: false })

      // Фильтрация по объектам для role=user
      if (allSites === false && userSiteIds && userSiteIds.length > 0) {
        query = query.in('site_id', userSiteIds)
      } else if (allSites === false && userSiteIds && userSiteIds.length === 0) {
        set({ approvedRequests: [], isLoading: false })
        return
      }

      const { data, error } = await query
      if (error) throw error

      set({ approvedRequests: (data ?? []).map(mapRequest), isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
      set({ error: message, isLoading: false })
    }
  },

  fetchRejectedRequests: async (userSiteIds?, allSites?) => {
    set({ isLoading: true, error: null })
    try {
      let query = supabase
        .from('payment_requests')
        .select(PR_SELECT)
        .not('rejected_at', 'is', null)
        .eq('is_deleted', false)
        .order('rejected_at', { ascending: false })

      // Фильтрация по объектам для role=user
      if (allSites === false && userSiteIds && userSiteIds.length > 0) {
        query = query.in('site_id', userSiteIds)
      } else if (allSites === false && userSiteIds && userSiteIds.length === 0) {
        set({ rejectedRequests: [], isLoading: false })
        return
      }

      const { data, error } = await query
      if (error) throw error

      set({ rejectedRequests: (data ?? []).map(mapRequest), isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
      set({ error: message, isLoading: false })
    }
  },

  fetchApprovedCount: async (userSiteIds?, allSites?) => {
    try {
      let query = supabase
        .from('payment_requests')
        .select('id', { count: 'exact', head: true })
        .not('approved_at', 'is', null)
        .eq('is_deleted', false)

      if (allSites === false && userSiteIds && userSiteIds.length > 0) {
        query = query.in('site_id', userSiteIds)
      } else if (allSites === false && userSiteIds && userSiteIds.length === 0) {
        set({ approvedCount: 0 })
        return
      }

      const { count, error } = await query
      if (error) throw error

      set({ approvedCount: count ?? 0 })
    } catch (err) {
      logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка получения счётчика согласованных', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchApprovedCount' } })
    }
  },

  fetchRejectedCount: async (userSiteIds?, allSites?) => {
    try {
      let query = supabase
        .from('payment_requests')
        .select('id', { count: 'exact', head: true })
        .not('rejected_at', 'is', null)
        .eq('is_deleted', false)

      if (allSites === false && userSiteIds && userSiteIds.length > 0) {
        query = query.in('site_id', userSiteIds)
      } else if (allSites === false && userSiteIds && userSiteIds.length === 0) {
        set({ rejectedCount: 0 })
        return
      }

      const { count, error } = await query
      if (error) throw error

      set({ rejectedCount: count ?? 0 })
    } catch (err) {
      logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка получения счётчика отклонённых', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'fetchRejectedCount' } })
    }
  },
}))
