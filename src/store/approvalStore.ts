import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import type { ApprovalStage, ApprovalDecision, PaymentRequest } from '@/types'

/** Сгруппированный этап для UI: номер этапа + массив подразделений */
export interface GroupedStage {
  stageOrder: number
  departmentIds: string[]
}

interface ApprovalStoreState {
  // Конфигурация цепочки
  stages: ApprovalStage[]
  isLoading: boolean
  error: string | null

  // Решения по заявке
  currentDecisions: ApprovalDecision[]

  // Списки заявок по вкладкам
  pendingRequests: PaymentRequest[]
  approvedRequests: PaymentRequest[]
  rejectedRequests: PaymentRequest[]

  // Конфигурация цепочки
  fetchStages: () => Promise<void>
  saveStages: (stages: GroupedStage[]) => Promise<void>

  // Решения
  fetchDecisions: (paymentRequestId: string) => Promise<void>
  approveRequest: (paymentRequestId: string, departmentId: string, userId: string, comment: string) => Promise<void>
  rejectRequest: (paymentRequestId: string, departmentId: string, userId: string, comment: string) => Promise<void>

  // Заявки по вкладкам
  fetchPendingRequests: (departmentId: string) => Promise<void>
  fetchApprovedRequests: () => Promise<void>
  fetchRejectedRequests: () => Promise<void>
}

/** Маппинг строки payment_requests из БД в PaymentRequest */
function mapRequest(row: Record<string, unknown>): PaymentRequest {
  const counterparties = row.counterparties as Record<string, unknown> | null
  const site = row.construction_sites as Record<string, unknown> | null
  const statuses = row.statuses as Record<string, unknown> | null
  const urgency = row.urgency as Record<string, unknown> | null
  const shipping = row.shipping as Record<string, unknown> | null
  return {
    id: row.id as string,
    requestNumber: row.request_number as string,
    counterpartyId: row.counterparty_id as string,
    siteId: (row.site_id as string) ?? null,
    statusId: row.status_id as string,
    urgencyId: row.urgency_id as string,
    urgencyReason: row.urgency_reason as string | null,
    deliveryDays: row.delivery_days as number,
    shippingConditionId: row.shipping_condition_id as string,
    comment: row.comment as string | null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    totalFiles: (row.total_files as number) ?? 0,
    uploadedFiles: (row.uploaded_files as number) ?? 0,
    withdrawnAt: row.withdrawn_at as string | null,
    currentStage: (row.current_stage as number) ?? null,
    approvedAt: row.approved_at as string | null,
    rejectedAt: row.rejected_at as string | null,
    counterpartyName: counterparties?.name as string | undefined,
    siteName: site?.name as string | undefined,
    statusName: statuses?.name as string | undefined,
    statusColor: (statuses?.color as string) ?? null,
    urgencyValue: urgency?.value as string | undefined,
    shippingConditionValue: shipping?.value as string | undefined,
  }
}

/** Общий select для payment_requests с join-ами */
const PR_SELECT = `
  *,
  counterparties(name),
  construction_sites(name),
  statuses!payment_requests_status_id_fkey(name, color),
  urgency:payment_request_field_options!payment_requests_urgency_id_fkey(value),
  shipping:payment_request_field_options!payment_requests_shipping_condition_id_fkey(value)
`

export const useApprovalStore = create<ApprovalStoreState>((set, get) => ({
  stages: [],
  isLoading: false,
  error: null,
  currentDecisions: [],
  pendingRequests: [],
  approvedRequests: [],
  rejectedRequests: [],

  fetchStages: async () => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('approval_stages')
        .select('*, departments(name)')
        .order('stage_order', { ascending: true })
      if (error) throw error

      const stages: ApprovalStage[] = (data ?? []).map((row: Record<string, unknown>) => {
        const dept = row.departments as Record<string, unknown> | null
        return {
          id: row.id as string,
          stageOrder: row.stage_order as number,
          departmentId: row.department_id as string,
          createdAt: row.created_at as string,
          departmentName: dept?.name as string | undefined,
        }
      })
      set({ stages, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки этапов'
      set({ error: message, isLoading: false })
    }
  },

  saveStages: async (grouped) => {
    set({ isLoading: true, error: null })
    try {
      // Удаляем все существующие этапы
      const { error: delError } = await supabase
        .from('approval_stages')
        .delete()
        .gte('stage_order', 0)
      if (delError) throw delError

      // Формируем строки для вставки
      const rows: { stage_order: number; department_id: string }[] = []
      for (const stage of grouped) {
        for (const deptId of stage.departmentIds) {
          rows.push({ stage_order: stage.stageOrder, department_id: deptId })
        }
      }

      if (rows.length > 0) {
        const { error: insError } = await supabase
          .from('approval_stages')
          .insert(rows)
        if (insError) throw insError
      }

      await get().fetchStages()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка сохранения этапов'
      set({ error: message, isLoading: false })
    }
  },

  fetchDecisions: async (paymentRequestId) => {
    try {
      const { data, error } = await supabase
        .from('approval_decisions')
        .select('*, departments(name), users(email)')
        .eq('payment_request_id', paymentRequestId)
        .order('stage_order', { ascending: true })
      if (error) throw error

      const decisions: ApprovalDecision[] = (data ?? []).map((row: Record<string, unknown>) => {
        const dept = row.departments as Record<string, unknown> | null
        const usr = row.users as Record<string, unknown> | null
        return {
          id: row.id as string,
          paymentRequestId: row.payment_request_id as string,
          stageOrder: row.stage_order as number,
          departmentId: row.department_id as string,
          status: row.status as ApprovalDecision['status'],
          userId: row.user_id as string | null,
          comment: row.comment as string,
          decidedAt: row.decided_at as string | null,
          createdAt: row.created_at as string,
          departmentName: dept?.name as string | undefined,
          userEmail: usr?.email as string | undefined,
        }
      })
      set({ currentDecisions: decisions })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки решений'
      set({ error: message })
    }
  },

  approveRequest: async (paymentRequestId, departmentId, userId, comment) => {
    set({ isLoading: true, error: null })
    try {
      // 1. Получаем текущий этап заявки
      const { data: pr, error: prError } = await supabase
        .from('payment_requests')
        .select('current_stage')
        .eq('id', paymentRequestId)
        .single()
      if (prError) throw prError
      const currentStage = pr.current_stage as number

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
        .eq('department_id', departmentId)
      if (updError) throw updError

      // 3. Проверяем все ли подразделения текущего этапа согласовали
      const { data: remaining, error: remError } = await supabase
        .from('approval_decisions')
        .select('id')
        .eq('payment_request_id', paymentRequestId)
        .eq('stage_order', currentStage)
        .eq('status', 'pending')
      if (remError) throw remError

      if ((remaining ?? []).length === 0) {
        // Все согласовали — проверяем следующий этап
        const { data: nextStages, error: nsError } = await supabase
          .from('approval_stages')
          .select('stage_order, department_id')
          .eq('stage_order', currentStage + 1)
        if (nsError) throw nsError

        if (nextStages && nextStages.length > 0) {
          // Есть следующий этап — создаём pending-записи
          const newDecisions = nextStages.map((s: Record<string, unknown>) => ({
            payment_request_id: paymentRequestId,
            stage_order: currentStage + 1,
            department_id: s.department_id as string,
            status: 'pending',
          }))
          const { error: insError } = await supabase
            .from('approval_decisions')
            .insert(newDecisions)
          if (insError) throw insError

          // Обновляем текущий этап
          const { error: upError } = await supabase
            .from('payment_requests')
            .update({ current_stage: currentStage + 1 })
            .eq('id', paymentRequestId)
          if (upError) throw upError
        } else {
          // Все этапы пройдены — устанавливаем статус Согласована
          const { data: statusData, error: stError } = await supabase
            .from('statuses')
            .select('id')
            .eq('entity_type', 'payment_request')
            .eq('code', 'approved')
            .single()
          if (stError) throw stError

          const { error: upError } = await supabase
            .from('payment_requests')
            .update({
              status_id: statusData.id,
              current_stage: null,
              approved_at: new Date().toISOString(),
            })
            .eq('id', paymentRequestId)
          if (upError) throw upError
        }
      }

      set({ isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка согласования'
      set({ error: message, isLoading: false })
    }
  },

  rejectRequest: async (paymentRequestId, departmentId, userId, comment) => {
    set({ isLoading: true, error: null })
    try {
      // 1. Получаем текущий этап
      const { data: pr, error: prError } = await supabase
        .from('payment_requests')
        .select('current_stage')
        .eq('id', paymentRequestId)
        .single()
      if (prError) throw prError

      // 2. Обновляем решение
      const { error: updError } = await supabase
        .from('approval_decisions')
        .update({
          status: 'rejected',
          user_id: userId,
          comment,
          decided_at: new Date().toISOString(),
        })
        .eq('payment_request_id', paymentRequestId)
        .eq('stage_order', pr.current_stage)
        .eq('department_id', departmentId)
      if (updError) throw updError

      // 3. Устанавливаем статус Отклонена
      const { data: statusData, error: stError } = await supabase
        .from('statuses')
        .select('id')
        .eq('entity_type', 'payment_request')
        .eq('code', 'rejected')
        .single()
      if (stError) throw stError

      const { error: upError } = await supabase
        .from('payment_requests')
        .update({
          status_id: statusData.id,
          current_stage: null,
          rejected_at: new Date().toISOString(),
        })
        .eq('id', paymentRequestId)
      if (upError) throw upError

      set({ isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка отклонения'
      set({ error: message, isLoading: false })
    }
  },

  fetchPendingRequests: async (departmentId) => {
    set({ isLoading: true, error: null })
    try {
      // Находим id заявок, ожидающих решения этого подразделения
      const { data: decisions, error: decError } = await supabase
        .from('approval_decisions')
        .select('payment_request_id')
        .eq('department_id', departmentId)
        .eq('status', 'pending')
      if (decError) throw decError

      const requestIds = [...new Set((decisions ?? []).map((d: Record<string, unknown>) => d.payment_request_id as string))]
      if (requestIds.length === 0) {
        set({ pendingRequests: [], isLoading: false })
        return
      }

      const { data, error } = await supabase
        .from('payment_requests')
        .select(PR_SELECT)
        .in('id', requestIds)
        .order('created_at', { ascending: false })
      if (error) throw error

      set({ pendingRequests: (data ?? []).map(mapRequest), isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
      set({ error: message, isLoading: false })
    }
  },

  fetchApprovedRequests: async () => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('payment_requests')
        .select(PR_SELECT)
        .not('approved_at', 'is', null)
        .order('approved_at', { ascending: false })
      if (error) throw error

      set({ approvedRequests: (data ?? []).map(mapRequest), isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
      set({ error: message, isLoading: false })
    }
  },

  fetchRejectedRequests: async () => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('payment_requests')
        .select(PR_SELECT)
        .not('rejected_at', 'is', null)
        .order('rejected_at', { ascending: false })
      if (error) throw error

      set({ rejectedRequests: (data ?? []).map(mapRequest), isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок'
      set({ error: message, isLoading: false })
    }
  },
}))
