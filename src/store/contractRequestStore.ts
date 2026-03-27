import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import { logError } from '@/services/errorLogger'
import { notifyContractNewRequest, notifyContractStatusChanged, notifyContractRevision } from '@/utils/contractNotificationService'
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
      let query = supabase
        .from('contract_requests')
        .select(`
          id, request_number, site_id, counterparty_id, supplier_id,
          parties_count, subject_type, subject_detail, status_id,
          revision_targets, created_by, created_at,
          is_deleted, deleted_at, original_received_at,
          counterparties(name),
          suppliers(name),
          construction_sites(name),
          statuses!contract_requests_status_id_fkey(name, color, code),
          creator:users!contract_requests_created_by_fkey(full_name)
        `)
        .order('created_at', { ascending: false })

      if (!includeDeleted) {
        query = query.eq('is_deleted', false)
      }

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

      const requests: ContractRequest[] = (data ?? []).map((row: Record<string, unknown>) => {
        const counterparty = row.counterparties as Record<string, unknown> | null
        const supplier = row.suppliers as Record<string, unknown> | null
        const site = row.construction_sites as Record<string, unknown> | null
        const status = row.statuses as Record<string, unknown> | null
        const creator = row.creator as Record<string, unknown> | null

        return {
          id: row.id as string,
          requestNumber: row.request_number as string,
          siteId: row.site_id as string,
          counterpartyId: row.counterparty_id as string,
          supplierId: row.supplier_id as string,
          partiesCount: row.parties_count as number,
          subjectType: row.subject_type as ContractRequest['subjectType'],
          subjectDetail: (row.subject_detail as string) ?? null,
          statusId: row.status_id as string,
          revisionTargets: (row.revision_targets as RevisionTarget[]) ?? [],
          createdBy: row.created_by as string,
          createdAt: row.created_at as string,
          isDeleted: (row.is_deleted as boolean) ?? false,
          deletedAt: (row.deleted_at as string) ?? null,
          originalReceivedAt: (row.original_received_at as string) ?? null,
          counterpartyName: counterparty?.name as string | undefined,
          supplierName: supplier?.name as string | undefined,
          siteName: site?.name as string | undefined,
          statusName: status?.name as string | undefined,
          statusColor: (status?.color as string) ?? null,
          statusCode: (status?.code as string) ?? undefined,
          creatorFullName: (creator?.full_name as string) ?? undefined,
        }
      })

      set({ requests, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки заявок на договор'
      set({ error: message, isLoading: false })
    }
  },

  createRequest: async (data, userId) => {
    set({ isSubmitting: true, error: null })
    try {
      // Получаем id статуса "Согласование ОМТС"
      const { data: statusData, error: statusError } = await supabase
        .from('statuses')
        .select('id')
        .eq('entity_type', 'contract_request')
        .eq('code', 'approv_omts')
        .single()
      if (statusError) throw statusError

      // Генерация номера через БД-функцию
      const { data: requestNumber, error: numError } = await supabase
        .rpc('generate_contract_request_number')
      if (numError) throw numError

      // Создание заявки
      const { data: requestData, error: reqError } = await supabase
        .from('contract_requests')
        .insert({
          request_number: requestNumber,
          site_id: data.siteId,
          counterparty_id: data.counterpartyId,
          supplier_id: data.supplierId,
          parties_count: data.partiesCount,
          subject_type: data.subjectType,
          subject_detail: data.subjectDetail || null,
          status_id: statusData.id,
          created_by: userId,
        })
        .select('id')
        .single()
      if (reqError) throw reqError

      // Уведомляем ОМТС о новой заявке
      notifyContractNewRequest(requestData.id, data.siteId, userId, requestNumber as string).catch(() => {})

      set({ isSubmitting: false })
      return { requestId: requestData.id as string, requestNumber: requestNumber as string }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания заявки на договор'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'createContractRequest' } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },

  updateRequest: async (id, data, _userId) => {
    set({ isSubmitting: true, error: null })
    try {
      const updateData: Record<string, unknown> = {}
      if (data.siteId !== undefined) updateData.site_id = data.siteId
      if (data.supplierId !== undefined) updateData.supplier_id = data.supplierId
      if (data.partiesCount !== undefined) updateData.parties_count = data.partiesCount
      if (data.subjectType !== undefined) updateData.subject_type = data.subjectType
      if (data.subjectDetail !== undefined) updateData.subject_detail = data.subjectDetail

      if (Object.keys(updateData).length === 0) {
        set({ isSubmitting: false })
        return
      }

      const { error } = await supabase
        .from('contract_requests')
        .update(updateData)
        .eq('id', id)
      if (error) throw error

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
      const { error } = await supabase
        .from('contract_requests')
        .update({ is_deleted: true, deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error

      await get().fetchRequests()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления заявки'
      set({ error: message, isLoading: false })
    }
  },

  fetchRequestFiles: async (requestId) => {
    try {
      const { data, error } = await supabase
        .from('contract_request_files')
        .select('id, contract_request_id, file_name, file_key, file_size, mime_type, created_by, created_at, is_additional, is_rejected, rejected_by, rejected_at')
        .eq('contract_request_id', requestId)
        .order('created_at', { ascending: true })
      if (error) throw error

      const files: ContractRequestFile[] = (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        contractRequestId: row.contract_request_id as string,
        fileName: row.file_name as string,
        fileKey: row.file_key as string,
        fileSize: row.file_size as number | null,
        mimeType: row.mime_type as string | null,
        createdBy: row.created_by as string,
        createdAt: row.created_at as string,
        isAdditional: (row.is_additional as boolean) ?? false,
        isRejected: (row.is_rejected as boolean) ?? false,
        rejectedBy: row.rejected_by as string | null,
        rejectedAt: row.rejected_at as string | null,
      }))

      set({ currentRequestFiles: files })
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
    const updateData = newRejected
      ? { is_rejected: true, rejected_by: userId, rejected_at: new Date().toISOString() }
      : { is_rejected: false, rejected_by: null, rejected_at: null }

    const { error } = await supabase
      .from('contract_request_files')
      .update(updateData)
      .eq('id', fileId)

    if (error) {
      logError({ errorType: 'api_error', errorMessage: error.message, errorStack: null, metadata: { action: 'toggleContractFileRejection', fileId } })
      return
    }

    set({
      currentRequestFiles: files.map((f) =>
        f.id === fileId
          ? { ...f, isRejected: newRejected, rejectedBy: newRejected ? userId : null, rejectedAt: newRejected ? updateData.rejected_at as string : null }
          : f,
      ),
    })
  },

  sendToRevision: async (id, targets, userId) => {
    set({ isSubmitting: true, error: null })
    try {
      // Получаем id статуса "На доработке"
      const { data: statusData, error: statusError } = await supabase
        .from('statuses')
        .select('id')
        .eq('entity_type', 'contract_request')
        .eq('code', 'on_revision')
        .single()
      if (statusError) throw statusError

      const { error } = await supabase
        .from('contract_requests')
        .update({
          status_id: statusData.id,
          revision_targets: targets,
        })
        .eq('id', id)
      if (error) throw error

      // Уведомляем Штаб и/или Подрядчика
      notifyContractRevision(id, targets, userId).catch(() => {})

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
      // Загружаем текущую заявку для получения revision_targets
      const { data: current, error: fetchErr } = await supabase
        .from('contract_requests')
        .select('revision_targets')
        .eq('id', id)
        .single()
      if (fetchErr) throw fetchErr

      const currentTargets = (current.revision_targets as string[]) ?? []
      const newTargets = currentTargets.filter((t) => t !== target)

      if (newTargets.length === 0) {
        // Все стороны завершили — возвращаем в "Согласование ОМТС"
        const { data: statusData, error: statusError } = await supabase
          .from('statuses')
          .select('id')
          .eq('entity_type', 'contract_request')
          .eq('code', 'approv_omts')
          .single()
        if (statusError) throw statusError

        const { error } = await supabase
          .from('contract_requests')
          .update({ status_id: statusData.id, revision_targets: [] })
          .eq('id', id)
        if (error) throw error

        // Уведомляем ОМТС
        const { data: reqData } = await supabase
          .from('contract_requests')
          .select('site_id, request_number')
          .eq('id', id)
          .single()
        if (reqData) {
          notifyContractNewRequest(id, reqData.site_id as string, userId, reqData.request_number as string).catch(() => {})
        }
      } else {
        // Ещё есть незакрытые стороны
        const { error } = await supabase
          .from('contract_requests')
          .update({ revision_targets: newTargets })
          .eq('id', id)
        if (error) throw error
      }

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
      // Получаем id статуса "Согласовано, ожидание оригинала"
      const { data: statusData, error: statusError } = await supabase
        .from('statuses')
        .select('id')
        .eq('entity_type', 'contract_request')
        .eq('code', 'approved_waiting')
        .single()
      if (statusError) throw statusError

      const { error } = await supabase
        .from('contract_requests')
        .update({ status_id: statusData.id, revision_targets: [] })
        .eq('id', id)
      if (error) throw error

      // Уведомляем подрядчика
      notifyContractStatusChanged(id, 'Согласовано, ожидание оригинала', userId).catch(() => {})

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
      // Получаем id статуса "Заключен"
      const { data: statusData, error: statusError } = await supabase
        .from('statuses')
        .select('id')
        .eq('entity_type', 'contract_request')
        .eq('code', 'concluded')
        .single()
      if (statusError) throw statusError

      const { error } = await supabase
        .from('contract_requests')
        .update({
          status_id: statusData.id,
          original_received_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error

      // Уведомляем подрядчика
      notifyContractStatusChanged(id, 'Заключен', userId).catch(() => {})

      await get().fetchRequests()
      set({ isSubmitting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка подтверждения оригинала'
      logError({ errorType: 'api_error', errorMessage: message, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'markOriginalReceived', id } })
      set({ error: message, isSubmitting: false })
      throw err
    }
  },
}))
