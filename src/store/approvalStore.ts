import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import { checkAndNotifyMissingSpecialists } from '@/utils/approvalNotifications'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import type { Department, ApprovalDecision, ApprovalDecisionFile, PaymentRequest, PaymentRequestLog } from '@/types'

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

  isLoading: boolean
  error: string | null

  // Решения и логи
  fetchDecisions: (paymentRequestId: string) => Promise<void>
  fetchLogs: (paymentRequestId: string) => Promise<void>
  approveRequest: (paymentRequestId: string, department: Department, userId: string, comment: string) => Promise<void>
  rejectRequest: (paymentRequestId: string, department: Department, userId: string, comment: string, files?: FileItem[]) => Promise<void>

  // Заявки по вкладкам
  fetchPendingRequests: (department: Department, userId: string, isAdmin?: boolean) => Promise<void>
  fetchApprovedRequests: (userSiteIds?: string[], allSites?: boolean) => Promise<void>
  fetchRejectedRequests: (userSiteIds?: string[], allSites?: boolean) => Promise<void>
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
    counterpartyName: counterparties?.name as string | undefined,
    siteName: site?.name as string | undefined,
    statusName: statuses?.name as string | undefined,
    statusColor: (statuses?.color as string) ?? null,
    shippingConditionValue: shipping?.value as string | undefined,
    assignedUserId: (currentAssignment?.assigned_user_id as string) ?? null,
    assignedUserEmail: (assignedUser?.email as string) ?? null,
    assignedUserFullName: (assignedUser?.full_name as string) ?? null,
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
  isLoading: false,
  error: null,

  fetchDecisions: async (paymentRequestId) => {
    try {
      const { data, error } = await supabase
        .from('approval_decisions')
        .select('*, users(email)')
        .eq('payment_request_id', paymentRequestId)
        .order('stage_order', { ascending: true })
      if (error) throw error

      const decisions: ApprovalDecision[] = await Promise.all(
        (data ?? []).map(async (row: Record<string, unknown>) => {
          const usr = row.users as Record<string, unknown> | null

          // Загружаем файлы для этого решения
          const { data: filesData } = await supabase
            .from('approval_decision_files')
            .select('*')
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
            files: files.length > 0 ? files : undefined,
          }
        })
      )
      console.log('[ApprovalStore] Загружено решений:', decisions.length, decisions.map(d => ({
        stage: d.stageOrder,
        dept: d.department,
        status: d.status,
        decidedAt: d.decidedAt
      })))
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
        .select('*, users(email)')
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
        .select('current_stage, site_id')
        .eq('id', paymentRequestId)
        .single()
      if (prError) throw prError
      const currentStage = pr.current_stage as number
      const siteId = pr.site_id as string

      // 2. Обновляем решение
      const { error: updError } = await supabase
        .from('approval_decisions')
        .update({
          status: 'approved',
          user_id: userId,
          comment,
          decided_at: new Date().toISOString(),
        })
        .eq('payment_request_id', paymentRequestId)
        .eq('stage_order', currentStage)
        .eq('department_id', department)
        .eq('status', 'pending')
      if (updError) throw updError

      // 3. ЖЕСТКАЯ ЛОГИКА ПЕРЕХОДА МЕЖДУ ЭТАПАМИ
      if (currentStage === 1) {
        // Этап 1 (Штаб) согласован → переходим на Этап 2 (ОМТС)
        await supabase.from('approval_decisions').insert({
          payment_request_id: paymentRequestId,
          stage_order: 2,
          department_id: 'omts',
          status: 'pending',
        })

        await supabase
          .from('payment_requests')
          .update({ current_stage: 2 })
          .eq('id', paymentRequestId)

        // Проверяем специалистов ОМТС для объекта
        await checkAndNotifyMissingSpecialists(paymentRequestId, siteId, 'omts')

      } else if (currentStage === 2) {
        // Этап 2 (ОМТС) согласован → статус Согласована
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
          })
          .eq('id', paymentRequestId)
      }

      set({ isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка согласования'
      set({ error: message, isLoading: false })
    }
  },

  rejectRequest: async (paymentRequestId, department, userId, comment, files = []) => {
    set({ isLoading: true, error: null })
    try {
      // 1. Получаем текущий этап и номер заявки
      const { data: pr, error: prError } = await supabase
        .from('payment_requests')
        .select('current_stage, request_number')
        .eq('id', paymentRequestId)
        .single()
      if (prError) throw prError

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

      set({ isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка отклонения'
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
      const { data: decisions, error: decError } = await supabase
        .from('approval_decisions')
        .select('payment_request_id')
        .eq('department_id', department)
        .eq('status', 'pending')
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

  fetchApprovedRequests: async (userSiteIds?, allSites?) => {
    set({ isLoading: true, error: null })
    try {
      let query = supabase
        .from('payment_requests')
        .select(PR_SELECT)
        .not('approved_at', 'is', null)
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
}))
