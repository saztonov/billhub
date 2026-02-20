import { useEffect, useMemo, useState, useCallback } from 'react'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { useAuthStore } from '@/store/authStore'
import { useApprovalStore } from '@/store/approvalStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useStatusStore } from '@/store/statusStore'
import { useAssignmentStore } from '@/store/assignmentStore'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import { supabase } from '@/services/supabase'
import type { PaymentRequest, Department } from '@/types'
import type { FilterValues } from '@/components/paymentRequests/RequestFilters'

/** Загрузить объекты пользователя из БД */
async function loadUserSiteIds(userId: string): Promise<{ allSites: boolean; siteIds: string[] }> {
  const { data: userData } = await supabase
    .from('users')
    .select('all_sites')
    .eq('id', userId)
    .single()
  const allSites = (userData?.all_sites as boolean) ?? false
  if (allSites) return { allSites: true, siteIds: [] }

  const { data: mappings } = await supabase
    .from('user_construction_sites_mapping')
    .select('construction_site_id')
    .eq('user_id', userId)
  const siteIds = (mappings ?? []).map((m: Record<string, unknown>) => m.construction_site_id as string)
  return { allSites: false, siteIds }
}

interface UsePaymentRequestsDataParams {
  activeTab: string
  refreshTrigger: number
  adminSelectedStage: Department
  showDeleted: boolean
  setFilters: (filters: FilterValues) => void
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
}: UsePaymentRequestsDataParams) {
  const user = useAuthStore((s) => s.user)

  const isCounterpartyUser = user?.role === 'counterparty_user'
  const isAdmin = user?.role === 'admin'
  const isUser = user?.role === 'user'
  const isOmtsUser = user?.department === 'omts'

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
  const { fetchStatuses } = useStatusStore()
  const { omtsUsers, fetchOmtsUsers, assignResponsible } = useAssignmentStore()

  const uploadTasks = useUploadQueueStore((s) => s.tasks)

  const {
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    isLoading: approvalLoading,
    fetchPendingRequests,
    fetchApprovedRequests,
    fetchRejectedRequests,
    approveRequest,
    rejectRequest,
  } = useApprovalStore()

  // Общее количество этапов согласования (Штаб -> ОМТС)
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

  // Устанавливаем фильтры по умолчанию в зависимости от роли
  useEffect(() => {
    if (isAdmin) {
      setFilters({ responsibleFilter: 'unassigned' })
    } else if (isOmtsUser) {
      setFilters({ myRequestsFilter: 'assigned_to_me' })
    }
  }, [isAdmin, isOmtsUser, setFilters])

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
  }, [fetchRequests, isCounterpartyUser, isAdmin, isUser, user?.counterpartyId, sitesLoaded, userSiteIds, userAllSites, showDeleted])

  // Загружаем pendingRequests для счетчика вкладки
  useEffect(() => {
    if (isCounterpartyUser || !sitesLoaded || !user?.id) return
    const department = isAdmin ? adminSelectedStage : user?.department
    if (department && userDeptInChain) {
      fetchPendingRequests(department, user.id, isAdmin)
    }
  }, [isCounterpartyUser, sitesLoaded, user?.id, user?.department, isAdmin, adminSelectedStage, userDeptInChain, fetchPendingRequests])

  // Загружаем данные при переключении вкладок
  useEffect(() => {
    if (!sitesLoaded) return

    if (isCounterpartyUser && user?.counterpartyId) {
      fetchRequests(user.counterpartyId)
      return
    }

    const [sIds, allS] = siteFilterParams()

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
    } else if (activeTab === 'approved') {
      fetchApprovedRequests(sIds, allS)
    } else if (activeTab === 'rejected') {
      fetchRejectedRequests(sIds, allS)
    }
  }, [activeTab, refreshTrigger, sitesLoaded, isCounterpartyUser, user?.counterpartyId, user?.id, user?.department, isUser, isAdmin, adminSelectedStage, userDeptInChain, userSiteIds, userAllSites, showDeleted, fetchRequests, fetchPendingRequests, fetchApprovedRequests, fetchRejectedRequests, siteFilterParams])

  // Загружаем справочники для фильтров
  useEffect(() => {
    if (!isCounterpartyUser) {
      fetchCounterparties()
      fetchSites()
      fetchStatuses('payment_request')
    } else {
      fetchSites()
    }
  }, [isCounterpartyUser, fetchCounterparties, fetchSites, fetchStatuses])

  // Загружаем список ОМТС для назначения
  useEffect(() => {
    if (isOmtsUser || isAdmin) {
      fetchOmtsUsers()
    }
  }, [isOmtsUser, isAdmin, fetchOmtsUsers])

  /** Проверяет, может ли текущий пользователь редактировать заявку */
  const canEditRequest = useCallback((record: PaymentRequest | null): boolean => {
    if (!record || isCounterpartyUser) return false
    if (isAdmin) return true
    if (isUser) {
      if (userAllSites) return true
      return userSiteIds.includes(record.siteId)
    }
    return false
  }, [isAdmin, isCounterpartyUser, isUser, userAllSites, userSiteIds])

  return {
    // Пользователь и роли
    user,
    isCounterpartyUser,
    isAdmin,
    isUser,
    isOmtsUser,
    userDeptInChain,
    totalStages,
    // Данные
    requests,
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    isLoading,
    approvalLoading,
    counterparties,
    sites,
    omtsUsers,
    uploadTasks,
    // Функции
    siteFilterParams,
    canEditRequest,
    fetchRequests,
    fetchCounterparties,
    fetchPendingRequests,
    approveRequest,
    rejectRequest,
    deleteRequest,
    withdrawRequest,
    resubmitRequest,
    updateRequest,
    assignResponsible,
  }
}
