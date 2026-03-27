import { useMemo, useCallback } from 'react'
import type { ContractRequest } from '@/types'

export interface ContractFilterValues {
  counterpartyId?: string
  siteId?: string
  supplierId?: string
  statusId?: string
  subjectType?: string
  requestNumber?: string
  dateFrom?: string
  dateTo?: string
}

interface UseContractRequestFilteringParams {
  requests: ContractRequest[]
  filters: ContractFilterValues
}

/**
 * Хук фильтрации заявок на договор.
 * Фильтрует по подрядчику, объекту, поставщику, статусу, номеру и периоду.
 */
export function useContractRequestFiltering({ requests, filters }: UseContractRequestFilteringParams) {
  const applyFilters = useCallback((items: ContractRequest[]) => {
    let filtered = items

    if (filters.counterpartyId) {
      filtered = filtered.filter((r) => r.counterpartyId === filters.counterpartyId)
    }
    if (filters.siteId) {
      filtered = filtered.filter((r) => r.siteId === filters.siteId)
    }
    if (filters.supplierId) {
      filtered = filtered.filter((r) => r.supplierId === filters.supplierId)
    }
    if (filters.statusId) {
      filtered = filtered.filter((r) => r.statusId === filters.statusId)
    }
    if (filters.subjectType) {
      filtered = filtered.filter((r) => r.subjectType === filters.subjectType)
    }
    if (filters.requestNumber) {
      filtered = filtered.filter((r) =>
        r.requestNumber.toLowerCase().includes(filters.requestNumber!.toLowerCase())
      )
    }
    if (filters.dateFrom) {
      filtered = filtered.filter((r) =>
        new Date(r.createdAt) >= new Date(filters.dateFrom!)
      )
    }
    if (filters.dateTo) {
      const nextDay = new Date(filters.dateTo!)
      nextDay.setDate(nextDay.getDate() + 1)
      filtered = filtered.filter((r) =>
        new Date(r.createdAt) < nextDay
      )
    }

    return filtered
  }, [filters])

  const filteredRequests = useMemo(() => applyFilters(requests), [requests, applyFilters])

  return { filteredRequests }
}
