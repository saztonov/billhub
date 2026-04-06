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
      const q = filters.requestNumber.toLowerCase()
      filtered = filtered.filter((r) =>
        r.requestNumber.toLowerCase().includes(q) ||
        (r.contractNumber ?? '').toLowerCase().includes(q)
      )
    }
    // Фильтр диапазона дат: попадание дат создания заявки ИЛИ даты подписания договора
    if (filters.dateFrom || filters.dateTo) {
      const from = filters.dateFrom ? new Date(filters.dateFrom) : null
      let toExclusive: Date | null = null
      if (filters.dateTo) {
        toExclusive = new Date(filters.dateTo)
        toExclusive.setDate(toExclusive.getDate() + 1)
      }
      const inRange = (iso?: string | null) => {
        if (!iso) return false
        const d = new Date(iso)
        if (from && d < from) return false
        if (toExclusive && d >= toExclusive) return false
        return true
      }
      filtered = filtered.filter((r) => inRange(r.createdAt) || inRange(r.contractSigningDate))
    }

    return filtered
  }, [filters])

  const filteredRequests = useMemo(() => applyFilters(requests), [requests, applyFilters])

  return { filteredRequests }
}
