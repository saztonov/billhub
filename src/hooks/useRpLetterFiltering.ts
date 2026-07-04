import { useMemo } from 'react'
import type { RpLetter } from '@/types'
import type { FilterValues } from '@/components/paymentRequests/RequestFilters'

/**
 * Клиентская фильтрация реестра РП тем же блоком фильтров, что и вкладки заявок.
 * Маппинг полей на РП: подрядчик/объект/поставщик — по id; сумма — totalAmount РП;
 * номер — совпадение по номеру заявки в составе РП, локальному номеру РП или
 * рег.номеру письма PayHub; даты — по createdAt (до следующего дня, как у заявок);
 * «мои» и «ответственный» — по создателю РП (у РП нет назначенного ответственного).
 * responsibleFilter (назначен/не назначен) к РП неприменим — игнорируется.
 */
export function useRpLetterFiltering(
  letters: RpLetter[],
  filters: FilterValues,
  userId?: string,
): RpLetter[] {
  return useMemo(() => {
    let filtered = letters

    if (filters.counterpartyId) {
      filtered = filtered.filter((l) => l.counterpartyId === filters.counterpartyId)
    }
    if (filters.siteId) {
      filtered = filtered.filter((l) => l.siteId === filters.siteId)
    }
    if (filters.supplierId) {
      filtered = filtered.filter((l) => l.supplierId === filters.supplierId)
    }
    if (filters.requestNumber) {
      const q = filters.requestNumber.toLowerCase()
      filtered = filtered.filter(
        (l) =>
          l.number.toLowerCase().includes(q) ||
          (l.payhubLetterRegNumber ?? '').toLowerCase().includes(q) ||
          l.requests.some((r) => r.requestNumber.toLowerCase().includes(q)),
      )
    }
    if (filters.dateFrom) {
      filtered = filtered.filter((l) => new Date(l.createdAt) >= new Date(filters.dateFrom!))
    }
    if (filters.dateTo) {
      const nextDay = new Date(filters.dateTo)
      nextDay.setDate(nextDay.getDate() + 1)
      filtered = filtered.filter((l) => new Date(l.createdAt) < nextDay)
    }
    if (filters.amountOperator && filters.amountValue != null) {
      const val = filters.amountValue
      filtered = filtered.filter((l) => {
        if (filters.amountOperator === '>=') return l.totalAmount >= val
        if (filters.amountOperator === '<=') return l.totalAmount <= val
        return l.totalAmount === val
      })
    }
    if (filters.responsibleUserId) {
      filtered = filtered.filter((l) => l.createdBy === filters.responsibleUserId)
    }
    if (filters.myRequestsFilter === 'assigned_to_me' && userId) {
      filtered = filtered.filter((l) => l.createdBy === userId)
    }

    return filtered
  }, [letters, filters, userId])
}
