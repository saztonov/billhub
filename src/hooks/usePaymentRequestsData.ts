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

  const [userSiteIds, setUserSiteIds] = useState<string[]>([])
  const [userAllSites, setUserAllSites] = useState(true)
  const [sitesLoaded, setSitesLoaded] = useState(false)

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
    isLoading: approvalLoading,
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

  // Параметры фильтрации для role=user
  const siteFilterParams = useCallback((): [string[]?, boolean?] => {
    if (!isUser) return [undefined, undefined]
    return [userSiteIds, userAllSites]
  }, [isUser, userSiteIds, userAllSites])

  // Устанавливаем фильтры по умолчанию для ОМТС (если не восстановлены из localStorage)
  useEffect(() => {
    if (isUser && isOmtsUser && !isMobile && !skipDefaultMyFilter) {
      setFilters((prev: FilterValues) =>
        prev.myRequestsFilter ? prev : { ...prev, myRequestsFilter: 'assigned_to_me' },
      )
    }
  }, [isUser, isOmtsUser, isMobile, setFilters, skipDefaultMyFilter])

  // Загружаем объекты пользователя для role=user
  useEffect(() => {
    if (!user?.id || !isUser) {
      setSitesLoaded(true)
      return
    }
    loadUserSiteIds(user.id).then(({ allSites, siteIds }) => {
      setUserAllSites(allSites)
      setUserSiteIds(siteIds)
      setSitesLoaded(true)
    })
  }, [user?.id, isUser])

  // Загрузка заявок
  useEffect(() => {
    if (!sitesLoaded) return
    if (isCounterpartyUser && user?.counterpartyId) {
      fetchRequests(user.counterpartyId)
    } else if (isAdmin) {
      fetchRequests(undefined, undefined, undefined, showDeleted)
    } else if (isUser) {
      fetchRequests(undefined, userSiteIds, userAllSites)
    }
  }, [
    fetchRequests,
    isCounterpartyUser,
    isAdmin,
    isUser,
    user?.counterpartyId,
    sitesLoaded,
    userSiteIds,
    userAllSites,
    showDeleted,
  ])

  // Загружаем pendingRequests для счетчика вкладки
  useEffect(() => {
    if (isCounterpartyUser || !sitesLoaded || !user?.id) return
    const department = isAdmin ? adminSelectedStage : user?.department
    if (department && userDeptInChain) {
      fetchPendingRequests(department, user.id, isAdmin)
    }
  }, [
    isCounterpartyUser,
    sitesLoaded,
    user?.id,
    user?.department,
    isAdmin,
    adminSelectedStage,
    userDeptInChain,
    fetchPendingRequests,
  ])

  // Загружаем свои назначения РП (определяет видимость вкладки «РП»)
  useEffect(() => {
    if (!isAdmin && !isUser) return
    fetchRpMy()
  }, [isAdmin, isUser, fetchRpMy])

  // Загружаем заявки этапа РП для счетчика вкладки
  useEffect(() => {
    if (!isRpAssignee && !isAdmin) return
    fetchRpPendingRequests()
  }, [isRpAssignee, isAdmin, fetchRpPendingRequests])

  // Загружаем данные при переключении вкладок и обновляем все счетчики
  useEffect(() => {
    if (!sitesLoaded) return

    if (isCounterpartyUser && user?.counterpartyId) {
      fetchRequests(user.counterpartyId)
      return
    }

    const [sIds, allS] = siteFilterParams()

    // Загружаем данные активной вкладки
    if (activeTab === 'all') {
      if (isUser) {
        fetchRequests(undefined, sIds, allS)
      } else if (isAdmin) {
        fetchRequests(undefined, undefined, undefined, showDeleted)
      }
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
      fetchApprovedRequests(sIds, allS, showDeleted)
    } else if (activeTab === 'rejected') {
      fetchRejectedRequests(sIds, allS, showDeleted)
    }

    // Обновляем счетчики всех вкладок
    fetchApprovedCount(sIds, allS, showDeleted)
    fetchRejectedCount(sIds, allS, showDeleted)
    if (activeTab !== 'all') {
      if (isUser) fetchRequests(undefined, sIds, allS)
      else if (isAdmin) fetchRequests(undefined, undefined, undefined, showDeleted)
    }
    if (activeTab !== 'pending' && user?.id && userDeptInChain) {
      const department = isAdmin ? adminSelectedStage : user?.department
      if (department) fetchPendingRequests(department, user.id, isAdmin)
    }
    if (activeTab !== 'rp' && (isRpAssignee || isAdmin)) {
      fetchRpPendingRequests()
    }
  }, [
    activeTab,
    refreshTrigger,
    sitesLoaded,
    isCounterpartyUser,
    user?.counterpartyId,
    user?.id,
    user?.department,
    isUser,
    isAdmin,
    isRpAssignee,
    adminSelectedStage,
    userDeptInChain,
    userSiteIds,
    userAllSites,
    showDeleted,
    fetchRequests,
    fetchPendingRequests,
    fetchRpPendingRequests,
    fetchApprovedRequests,
    fetchRejectedRequests,
    fetchApprovedCount,
    fetchRejectedCount,
    siteFilterParams,
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
        if (userAllSites) return true
        return userSiteIds.includes(record.siteId)
      }
      return false
    },
    [isAdmin, isCounterpartyUser, isUser, userAllSites, userSiteIds],
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
    approvalLoading,
    counterparties,
    sites,
    statuses,
    suppliers,
    omtsUsers,
    uploadTasks,
    // Функции
    siteFilterParams,
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
