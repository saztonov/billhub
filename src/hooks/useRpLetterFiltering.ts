import { useMemo } from 'react'
import type { RpLetter } from '@/types'
import type { FilterValues } from '@/components/paymentRequests/RequestFilters'

/**
 * Клиентская фильтрация реестра РП тем же блоком фильтров, что и вкладки заявок.
 * Применяются только letter-native поля: подрядчик/объект/поставщик — по id;
 * сумма — totalAmount РП; номер — совпадение по номеру заявки в составе РП,
 * локальному номеру РП или рег.номеру письма PayHub; даты — по createdAt
 * (до следующего дня, как у заявок).
 * Request-only фильтры к реестру НЕ применяются: «мои» (myRequestsFilter),
 * «ответственный» (responsibleFilter/responsibleUserId) — у писем нет назначенного
 * ответственного, а авто-дефолт ОМТС «назначенные мне» не должен скрывать реестр.
 */
export function useRpLetterFiltering(letters: RpLetter[], filters: FilterValues): RpLetter[] {
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
    return filtered
  }, [letters, filters])
}
