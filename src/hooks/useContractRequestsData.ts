import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useContractRequestStore } from '@/store/contractRequestStore'
import { useContractCommentStore } from '@/store/contractCommentStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useSupplierStore } from '@/store/supplierStore'
import { useStatusStore } from '@/store/statusStore'
import { api } from '@/services/api'

interface UseContractRequestsDataParams {
  showDeleted: boolean
}

/** Загрузить объекты пользователя через API */
async function loadUserSiteIds(userId: string): Promise<{ allSites: boolean; siteIds: string[] }> {
  const data = await api.get<{ allSites: boolean; siteIds: string[] }>(
    `/api/users/${userId}/site-ids`,
  )
  return data ?? { allSites: true, siteIds: [] }
}

/**
 * Хук загрузки данных страницы заявок на договор.
 * Управляет загрузкой справочников, заявок, объектов пользователя.
 */
export function useContractRequestsData({ showDeleted }: UseContractRequestsDataParams) {
  const user = useAuthStore((s) => s.user)
  const isCounterpartyUser = user?.role === 'counterparty_user'
  const isAdmin = user?.role === 'admin'
  const isUser = user?.role === 'user'
  const isOmtsUser = user?.department === 'omts'
  const isShtabUser = user?.department === 'shtab'

  // Сторы
  const {
    requests,
    isLoading,
    fetchRequests,
    createRequest,
    updateRequest,
    deleteRequest,
    fetchRequestFiles,
    currentRequestFiles,
    toggleFileRejection,
    sendToRevision,
    completeRevision,
    approveRequest,
    markOriginalReceived,
    isSubmitting,
  } = useContractRequestStore()

  const counterparties = useCounterpartyStore((s) => s.counterparties)
  const fetchCounterparties = useCounterpartyStore((s) => s.fetchCounterparties)
  const sites = useConstructionSiteStore((s) => s.sites)
  const fetchSites = useConstructionSiteStore((s) => s.fetchSites)
  const suppliers = useSupplierStore((s) => s.suppliers)
  const fetchSuppliers = useSupplierStore((s) => s.fetchSuppliers)
  const statuses = useStatusStore((s) => s.statuses)
  const fetchStatuses = useStatusStore((s) => s.fetchStatuses)

  const { fetchUnreadCounts, unreadCounts } = useContractCommentStore()

  // Объекты пользователя (для role=user)
  const [userSiteIds, setUserSiteIds] = useState<string[]>([])
  const [userAllSites, setUserAllSites] = useState(true)
  const [sitesLoaded, setSitesLoaded] = useState(false)

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
  const loadRequests = useCallback(() => {
    if (!sitesLoaded) return
    if (isCounterpartyUser && user?.counterpartyId) {
      fetchRequests(user.counterpartyId)
    } else if (isAdmin) {
      fetchRequests(undefined, undefined, undefined, showDeleted)
    } else if (isUser) {
      // Штаб видит только по своим объектам
      if (isShtabUser) {
        fetchRequests(undefined, userSiteIds, userAllSites)
      } else {
        fetchRequests(undefined, undefined, undefined)
      }
    }
  }, [sitesLoaded, isCounterpartyUser, isAdmin, isUser, isShtabUser, user?.counterpartyId, showDeleted, userSiteIds, userAllSites, fetchRequests])

  useEffect(() => {
    loadRequests()
  }, [loadRequests])

  // Загрузка справочников
  useEffect(() => {
    fetchSites()
    fetchSuppliers()
    fetchStatuses('contract_request')
    if (!isCounterpartyUser) {
      fetchCounterparties()
    }
  }, [isCounterpartyUser, fetchSites, fetchSuppliers, fetchStatuses, fetchCounterparties])

  // Непрочитанные комментарии
  useEffect(() => {
    if (user?.id) {
      fetchUnreadCounts(user.id)
    }
  }, [user?.id, fetchUnreadCounts])

  // Проверка прав на редактирование
  const canEditRequest = useCallback((record: { statusCode?: string } | null): boolean => {
    if (!record) return false
    if (isCounterpartyUser) return false // Подрядчик не может редактировать
    if (isAdmin) return true
    if (isOmtsUser) return true
    return false
  }, [isAdmin, isCounterpartyUser, isOmtsUser])

  return {
    // Пользователь и роли
    user,
    isCounterpartyUser,
    isAdmin,
    isUser,
    isOmtsUser,
    isShtabUser,
    // Данные
    requests,
    isLoading,
    isSubmitting,
    currentRequestFiles,
    // Справочники
    counterparties,
    sites,
    suppliers,
    statuses,
    unreadCounts,
    // Функции
    loadRequests,
    createRequest,
    updateRequest,
    deleteRequest,
    fetchRequestFiles,
    toggleFileRejection,
    sendToRevision,
    completeRevision,
    approveRequest,
    markOriginalReceived,
    canEditRequest,
  }
}
