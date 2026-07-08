import { useEffect, useCallback } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useContractRequestStore } from '@/store/contractRequestStore'
import { useContractCommentStore } from '@/store/contractCommentStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useSupplierStore } from '@/store/supplierStore'
import { useStatusStore } from '@/store/statusStore'

interface UseContractRequestsDataParams {
  showDeleted: boolean
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

  // Загрузка заявок. Скоупинг по объектам (для user без all_sites) выполняет сервер —
  // клиентские siteIds/allSites и ожидание /site-ids (водопад) больше не нужны.
  const loadRequests = useCallback(() => {
    if (isCounterpartyUser && user?.counterpartyId) {
      fetchRequests(user.counterpartyId)
    } else if (isAdmin) {
      fetchRequests(undefined, showDeleted)
    } else if (isUser) {
      fetchRequests()
    }
  }, [isCounterpartyUser, isAdmin, isUser, user?.counterpartyId, showDeleted, fetchRequests])

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
  const canEditRequest = useCallback(
    (record: { statusCode?: string } | null): boolean => {
      if (!record) return false
      if (isAdmin) return true
      // Подрядчик может редактировать шапку до перехода в "Согласовано. Ожидание оригинала" / "Заключен"
      if (isCounterpartyUser) {
        return record.statusCode !== 'approved_waiting' && record.statusCode !== 'concluded'
      }
      if (isOmtsUser) return true
      return false
    },
    [isAdmin, isCounterpartyUser, isOmtsUser],
  )

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
