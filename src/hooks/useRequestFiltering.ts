import { useMemo, useCallback } from 'react'
import type { PaymentRequest } from '@/types'
import type { FilterValues } from '@/components/paymentRequests/RequestFilters'

interface UseRequestFilteringParams {
  requests: PaymentRequest[]
  pendingRequests: PaymentRequest[]
  approvedRequests: PaymentRequest[]
  rejectedRequests: PaymentRequest[]
  omtsRpPendingRequests: PaymentRequest[]
  filters: FilterValues
  userId?: string
  isAdmin: boolean
}

/**
 * Хук фильтрации заявок на оплату.
 * Применяет фильтры к спискам заявок, разделяет по статусам для контрагента.
 */
export function useRequestFiltering({
  requests,
  pendingRequests,
  approvedRequests,
  rejectedRequests,
  omtsRpPendingRequests,
  filters,
  userId,
  isAdmin,
}: UseRequestFilteringParams) {
  // Общая функция фильтрации для admin/user
  const applyFilters = useCallback((items: PaymentRequest[]) => {
    let filtered = items

    if (filters.counterpartyId) {
      filtered = filtered.filter(r => r.counterpartyId === filters.counterpartyId)
    }
    if (filters.siteId) {
      filtered = filtered.filter(r => r.siteId === filters.siteId)
    }
    if (filters.statusId) {
      filtered = filtered.filter(r => r.statusId === filters.statusId)
    }
    if (filters.supplierId) {
      filtered = filtered.filter(r => r.supplierId === filters.supplierId)
    }
    if (filters.requestNumber) {
      filtered = filtered.filter(r =>
        r.requestNumber.toLowerCase().includes(filters.requestNumber!.toLowerCase())
      )
    }
    if (filters.dateFrom) {
      filtered = filtered.filter(r =>
        new Date(r.createdAt) >= new Date(filters.dateFrom!)
      )
    }
    if (filters.dateTo) {
      const nextDay = new Date(filters.dateTo!)
      nextDay.setDate(nextDay.getDate() + 1)
      filtered = filtered.filter(r =>
        new Date(r.createdAt) < nextDay
      )
    }
    if (filters.responsibleFilter === 'assigned') {
      filtered = filtered.filter(r => r.assignedUserId !== null)
    } else if (filters.responsibleFilter === 'unassigned') {
      filtered = filtered.filter(r => r.assignedUserId === null)
    }
    if (filters.responsibleUserId) {
      filtered = filtered.filter(r => r.assignedUserId === filters.responsibleUserId)
    }
    if (filters.myRequestsFilter === 'assigned_to_me' && userId) {
      filtered = filtered.filter(r => r.assignedUserId === userId)
    }
    if (filters.amountOperator && filters.amountValue != null) {
      const val = filters.amountValue
      filtered = filtered.filter(r => {
        const amount = r.invoiceAmount ?? 0
        if (filters.amountOperator === '>=') return amount >= val
        if (filters.amountOperator === '<=') return amount <= val
        return amount === val
      })
    }

    return filtered
  }, [filters, userId])

  // Фильтрация для counterparty_user (только объект, дата, номер)
  const applyCounterpartyFilters = useCallback((items: PaymentRequest[]) => {
    let filtered = items
    if (filters.siteId) {
      filtered = filtered.filter(r => r.siteId === filters.siteId)
    }
    if (filters.supplierId) {
      filtered = filtered.filter(r => r.supplierId === filters.supplierId)
    }
    if (filters.statusId) {
      filtered = filtered.filter(r => r.statusId === filters.statusId)
    }
    if (filters.requestNumber) {
      filtered = filtered.filter(r =>
        r.requestNumber.toLowerCase().includes(filters.requestNumber!.toLowerCase())
      )
    }
    if (filters.dateFrom) {
      filtered = filtered.filter(r =>
        new Date(r.createdAt) >= new Date(filters.dateFrom!)
      )
    }
    if (filters.dateTo) {
      const nextDay = new Date(filters.dateTo!)
      nextDay.setDate(nextDay.getDate() + 1)
      filtered = filtered.filter(r =>
        new Date(r.createdAt) < nextDay
      )
    }
    return filtered
  }, [filters])

  // Фильтрованные списки для admin/user
  const filteredRequests = useMemo(() => applyFilters(requests), [requests, applyFilters])
  const filteredPendingRequests = useMemo(() => applyFilters(pendingRequests), [pendingRequests, applyFilters])
  const filteredApprovedRequests = useMemo(() => applyFilters(approvedRequests), [approvedRequests, applyFilters])
  const filteredRejectedRequests = useMemo(() => applyFilters(rejectedRequests), [rejectedRequests, applyFilters])
  // Для ОМТС РП не применяем фильтры по ответственному (заявки на этапе ОМТС РП не привязаны к assignedUserId)
  const applyFiltersWithoutResponsible = useCallback((items: PaymentRequest[]) => {
    let filtered = items
    if (filters.counterpartyId) filtered = filtered.filter(r => r.counterpartyId === filters.counterpartyId)
    if (filters.siteId) filtered = filtered.filter(r => r.siteId === filters.siteId)
    if (filters.requestNumber) filtered = filtered.filter(r => r.requestNumber.toLowerCase().includes(filters.requestNumber!.toLowerCase()))
    if (filters.dateFrom) filtered = filtered.filter(r => new Date(r.createdAt) >= new Date(filters.dateFrom!))
    if (filters.dateTo) {
      const nextDay = new Date(filters.dateTo!)
      nextDay.setDate(nextDay.getDate() + 1)
      filtered = filtered.filter(r => new Date(r.createdAt) < nextDay)
    }
    if (filters.amountOperator && filters.amountValue != null) {
      const val = filters.amountValue
      filtered = filtered.filter(r => {
        const amount = r.invoiceAmount ?? 0
        if (filters.amountOperator === '>=') return amount >= val
        if (filters.amountOperator === '<=') return amount <= val
        return amount === val
      })
    }
    return filtered
  }, [filters])
  const filteredOmtsRpPendingRequests = useMemo(() => applyFiltersWithoutResponsible(omtsRpPendingRequests), [omtsRpPendingRequests, applyFiltersWithoutResponsible])

  // Разделение заявок counterparty_user по статусам
  const counterpartyPendingRequests = useMemo(() =>
    requests.filter(r =>
      r.currentStage !== null &&
      r.approvedAt === null &&
      r.rejectedAt === null &&
      r.withdrawnAt === null
    ), [requests])
  const counterpartyApprovedRequests = useMemo(() =>
    requests.filter(r => r.approvedAt !== null), [requests])
  const counterpartyRejectedRequests = useMemo(() =>
    requests.filter(r => r.rejectedAt !== null), [requests])

  // Фильтрованные counterparty списки
  const filteredCounterpartyAll = useMemo(() =>
    applyCounterpartyFilters(requests), [requests, applyCounterpartyFilters])
  const filteredCounterpartyPending = useMemo(() =>
    applyCounterpartyFilters(counterpartyPendingRequests), [counterpartyPendingRequests, applyCounterpartyFilters])
  const filteredCounterpartyApproved = useMemo(() =>
    applyCounterpartyFilters(counterpartyApprovedRequests), [counterpartyApprovedRequests, applyCounterpartyFilters])
  const filteredCounterpartyRejected = useMemo(() =>
    applyCounterpartyFilters(counterpartyRejectedRequests), [counterpartyRejectedRequests, applyCounterpartyFilters])

  // Статистика для вкладки "На согласование"
  const totalInvoiceAmount = useMemo(() => {
    return filteredPendingRequests.reduce((sum, req) => {
      return sum + (req.invoiceAmount ?? 0)
    }, 0)
  }, [filteredPendingRequests])

  // Статистика для вкладки "Все"
  const totalInvoiceAmountAll = useMemo(() => {
    return filteredRequests.reduce((sum, req) => sum + (req.invoiceAmount ?? 0), 0)
  }, [filteredRequests])

  const totalPaidAll = useMemo(() => {
    return filteredRequests.reduce((sum, req) => sum + (req.totalPaid ?? 0), 0)
  }, [filteredRequests])

  // Статистика для counterparty_user (вкладка "Все")
  const totalCounterpartyInvoiceAmountAll = useMemo(() => {
    return filteredCounterpartyAll.reduce((sum, req) => sum + (req.invoiceAmount ?? 0), 0)
  }, [filteredCounterpartyAll])

  const totalCounterpartyPaidAll = useMemo(() => {
    return filteredCounterpartyAll.reduce((sum, req) => sum + (req.totalPaid ?? 0), 0)
  }, [filteredCounterpartyAll])

  const unassignedOmtsCount = useMemo(() => {
    if (!isAdmin) return 0
    return filteredPendingRequests.filter(req =>
      req.currentStage === 2 && !req.assignedUserId
    ).length
  }, [filteredPendingRequests, isAdmin])

  return {
    // Фильтрованные списки admin/user
    filteredRequests,
    filteredPendingRequests,
    filteredApprovedRequests,
    filteredRejectedRequests,
    filteredOmtsRpPendingRequests,
    // Фильтрованные списки counterparty
    filteredCounterpartyAll,
    filteredCounterpartyPending,
    filteredCounterpartyApproved,
    filteredCounterpartyRejected,
    // Статистика
    totalInvoiceAmount,
    totalInvoiceAmountAll,
    totalPaidAll,
    totalCounterpartyInvoiceAmountAll,
    totalCounterpartyPaidAll,
    unassignedOmtsCount,
  }
}
