import { useEffect, useMemo, useState, useCallback } from 'react'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { useAuthStore } from '@/store/authStore'
import { useApprovalStore } from '@/store/approvalStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useStatusStore } from '@/store/statusStore'
import { useAssignmentStore } from '@/store/assignmentStore'
import { useRpStageStore } from '@/store/rpStageStore'
import { useSupplierStore } from '@/store/supplierStore'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import { api } from '@/services/api'
import type { PaymentRequest, Department } from '@/types'
import type { FilterValues } from '@/components/paymentRequests/RequestFilters'

/** Загрузить объекты пользователя через API */
async function loadUserSiteIds(userId: string): Promise<{ allSites: boolean; siteIds: string[] }> {
  const data = await api.get<{ allSites: boolean; siteIds: string[] }>(
    `/api/users/${userId}/site-ids`,
  )
  return data ?? { allSites: true, siteIds: [] }
}

interface UsePaymentRequestsDataParams {
  activeTab: string
  refreshTrigger: number
  adminSelectedStage: Department
  showDeleted: boolean
  setFilters: (filters: FilterValues | ((prev: FilterValues) => FilterValues)) => void
  isMobile: boolean
  /** Не применять авто-дефолт «мои заявки» для ОМТС (на странице РП фильтр иной семантики). */
  skipDefaultMyFilter?: boolean
}

/**
 * Хук загрузки данных страницы заявок на оплату.
 * Управляет загрузкой справочников, заявок, объектов пользователя.
 */
export function usePaymentRequestsData({
  activeTab,
  refreshTrigger,
  adminSelectedStage,
  showDeleted,
  setFilters,
  isMobile,
  skipDefaultMyFilter = false,
}: UsePaymentRequestsDataParams) {
  const user = useAuthStore((s) => s.user)

  const isCounterpartyUser = user?.role === 'counterparty_user'
  const isAdmin = user?.role === 'admin'
  const isUser = user?.role === 'user'
  const isOmtsUser = user?.department === 'omts'
  const isShtabUser = user?.department === 'shtab'

  // Объекты пользователя нужны только для canEditRequest; загрузка неблокирующая,
  // null = ответ ещё не пришёл (до этого редактирование запрещено — безопасный дефолт).
  const [siteScope, setSiteScope] = useState<{ allSites: boolean; siteIds: string[] } | null>(null)

  const {
    requests,
    isLoading,
    fetchRequests,
    deleteRequest,
    withdrawRequest,
    resubmitRequest,
    updateRequest,
  } = usePaymentRequestStore()

  const { counterparties, fetchCounterparties } = useCounterpartyStore()
  const { sites, fetchSites } = useConstructionSiteStore()
  const { statuses, fetchStatuses } = useStatusStore()
  const { suppliers, fetchSuppliers } = useSupplierStore()
  const { omtsUsers, fetchOmtsUsers, assignResponsible } = useAssignmentStore()
  const { mySiteIds: rpMySiteIds, fetchMy: fetchRpMy } = useRpStageStore()
  // Назначенец этапа «РП» — есть хотя бы один объект в rp_stage_assignees
  const isRpAssignee = rpMySiteIds.length > 0

  const uploadTasks = useUploadQueueStore((s) => s.tasks)

  const {
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    rpPendingRequests,
    approvedCount,
    rejectedCount,
    listLoading: approvalListLoading,
    fetchPendingRequests,
    fetchRpPendingRequests,
    fetchApprovedRequests,
    fetchRejectedRequests,
    fetchApprovedCount,
    fetchRejectedCount,
    approveRequest,
    rejectRequest,
  } = useApprovalStore()

  // Базовое количество этапов согласования (Штаб -> ОМТС); этап «РП» добавляется
  // по факту у конкретной заявки (см. getRequestTotalStages).
  const totalStages = 2

  // Участвует ли подразделение пользователя в цепочке
  const userDeptInChain = useMemo(() => {
    if (isAdmin) return true
    if (!user?.department) return false
    return user.department === 'shtab' || user.department === 'omts'
  }, [isAdmin, user?.department])

  // Устанавливаем фильтры по умолчанию для ОМТС (если не восстановлены из localStorage)
  useEffect(() => {
    if (isUser && isOmtsUser && !isMobile && !skipDefaultMyFilter) {
      setFilters((prev: FilterValues) =>
        prev.myRequestsFilter ? prev : { ...prev, myRequestsFilter: 'assigned_to_me' },
      )
    }
  }, [isUser, isOmtsUser, isMobile, setFilters, skipDefaultMyFilter])

  // Загружаем объекты пользователя для role=user — неблокирующе, только для canEditRequest
  useEffect(() => {
    if (!user?.id || !isUser) return
    let cancelled = false
    loadUserSiteIds(user.id).then((scope) => {
      if (!cancelled) setSiteScope(scope)
    })
    return () => {
      cancelled = true
    }
  }, [user?.id, isUser])

  // Загружаем свои назначения РП (определяет видимость вкладки «РП»)
  useEffect(() => {
    if (!isAdmin && !isUser) return
    fetchRpMy()
  }, [isAdmin, isUser, fetchRpMy])

  // Стал известен статус назначенца РП (fetchRpMy резолвился) — подгружаем только
  // счётчик вкладки «РП», не перезапуская остальные загрузки.
  useEffect(() => {
    if (!isRpAssignee) return
    fetchRpPendingRequests()
  }, [isRpAssignee, fetchRpPendingRequests])

  // Загружаем данные при монтировании/переключении вкладок и обновляем все счетчики.
  // Скоупинг по объектам выполняет сервер — клиентских siteIds/allSites больше нет.
  useEffect(() => {
    if (isCounterpartyUser && user?.counterpartyId) {
      fetchRequests(user.counterpartyId)
      return
    }
    if (!isUser && !isAdmin) return

    // Загружаем данные активной вкладки
    if (activeTab === 'all') {
      fetchRequests(undefined, isAdmin && showDeleted)
    } else if (activeTab === 'pending') {
      if (user?.id && userDeptInChain) {
        const department = isAdmin ? adminSelectedStage : user?.department
        if (department) {
          fetchPendingRequests(department, user.id, isAdmin)
        }
      }
    } else if (activeTab === 'rp') {
      fetchRpPendingRequests()
    } else if (activeTab === 'approved') {
      fetchApprovedRequests(showDeleted)
    } else if (activeTab === 'rejected') {
      fetchRejectedRequests(showDeleted)
    }

    // Обновляем счетчики всех вкладок
    fetchApprovedCount(showDeleted)
    fetchRejectedCount(showDeleted)
    if (activeTab !== 'all') {
      fetchRequests(undefined, isAdmin && showDeleted)
    }
    if (activeTab !== 'pending' && user?.id && userDeptInChain) {
      const department = isAdmin ? adminSelectedStage : user?.department
      if (department) fetchPendingRequests(department, user.id, isAdmin)
    }
    // isRpAssignee читаем в момент выполнения: его резолв не должен перезапускать весь эффект
    const rpAssignee = useRpStageStore.getState().mySiteIds.length > 0
    if (activeTab !== 'rp' && (rpAssignee || isAdmin)) {
      fetchRpPendingRequests()
    }
  }, [
    activeTab,
    refreshTrigger,
    isCounterpartyUser,
    user?.counterpartyId,
    user?.id,
    user?.department,
    isUser,
    isAdmin,
    adminSelectedStage,
    userDeptInChain,
    showDeleted,
    fetchRequests,
    fetchPendingRequests,
    fetchRpPendingRequests,
    fetchApprovedRequests,
    fetchRejectedRequests,
    fetchApprovedCount,
    fetchRejectedCount,
  ])

  // Загружаем справочники для фильтров
  useEffect(() => {
    fetchSites()
    fetchSuppliers()
    fetchStatuses('payment_request')
    if (!isCounterpartyUser) {
      fetchCounterparties()
    }
  }, [isCounterpartyUser, fetchCounterparties, fetchSites, fetchStatuses, fetchSuppliers])

  // Загружаем список ОМТС для назначения ответственного
  useEffect(() => {
    if (isOmtsUser || isAdmin) {
      fetchOmtsUsers()
    }
  }, [isOmtsUser, isAdmin, fetchOmtsUsers])

  /** Проверяет, может ли текущий пользователь редактировать заявку */
  const canEditRequest = useCallback(
    (record: PaymentRequest | null): boolean => {
      if (!record || isCounterpartyUser) return false
      if (isAdmin) return true
      if (isUser) {
        if (user?.allSites) return true
        // Объекты ещё не загружены — запрещаем (безопасный дефолт до прихода ответа)
        if (!siteScope) return false
        return siteScope.allSites || siteScope.siteIds.includes(record.siteId)
      }
      return false
    },
    [isAdmin, isCounterpartyUser, isUser, user?.allSites, siteScope],
  )

  return {
    // Пользователь и роли
    user,
    isCounterpartyUser,
    isAdmin,
    isUser,
    isOmtsUser,
    isShtabUser,
    isRpAssignee,
    userDeptInChain,
    totalStages,
    // Данные
    requests,
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    rpPendingRequests,
    approvedCount,
    rejectedCount,
    isLoading,
    approvalListLoading,
    counterparties,
    sites,
    statuses,
    suppliers,
    omtsUsers,
    uploadTasks,
    // Функции
    canEditRequest,
    fetchRequests,
    fetchCounterparties,
    fetchPendingRequests,
    fetchRpPendingRequests,
    fetchApprovedCount,
    fetchRejectedCount,
    approveRequest,
    rejectRequest,
    deleteRequest,
    withdrawRequest,
    resubmitRequest,
    updateRequest,
    assignResponsible,
  }
}
