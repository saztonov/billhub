import { useState, useCallback } from 'react'
import type { FilterValues } from '@/components/paymentRequests/RequestFilters'

/**
 * Фильтры заявок с сохранением в localStorage (ключ billhub_filters).
 * Инициализация мигрирует старые раздельные ключи; setFilters сохраняет
 * только непустые значения. Вынесено из PaymentRequestsPage для читаемости.
 */
export function usePersistentRequestFilters() {
  const [filters, setFiltersState] = useState<FilterValues>(() => {
    try {
      // Миграция старых ключей
      const oldMyRequests = localStorage.getItem('billhub_my_requests_filter')
      const oldResponsible = localStorage.getItem('billhub_responsible_filter')
      const oldResponsibleUserId = localStorage.getItem('billhub_responsible_user_id')
      if (oldMyRequests || oldResponsible || oldResponsibleUserId) {
        const migrated: FilterValues = {}
        if (oldMyRequests)
          migrated.myRequestsFilter = oldMyRequests as FilterValues['myRequestsFilter']
        if (oldResponsible)
          migrated.responsibleFilter = oldResponsible as FilterValues['responsibleFilter']
        if (oldResponsibleUserId) migrated.responsibleUserId = oldResponsibleUserId
        localStorage.setItem('billhub_filters', JSON.stringify(migrated))
        localStorage.removeItem('billhub_my_requests_filter')
        localStorage.removeItem('billhub_responsible_filter')
        localStorage.removeItem('billhub_responsible_user_id')
        return migrated
      }
      const saved = localStorage.getItem('billhub_filters')
      if (saved) return JSON.parse(saved) as FilterValues
    } catch {
      /* ignore */
    }
    return {}
  })

  const setFilters = useCallback((val: FilterValues | ((prev: FilterValues) => FilterValues)) => {
    setFiltersState((prev) => {
      const next = typeof val === 'function' ? val(prev) : { ...prev, ...val }
      try {
        // Сохраняем только непустые значения
        const toSave: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(next)) {
          if (v !== undefined && v !== null && v !== '') toSave[k] = v
        }
        if (Object.keys(toSave).length > 0) {
          localStorage.setItem('billhub_filters', JSON.stringify(toSave))
        } else {
          localStorage.removeItem('billhub_filters')
        }
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  return { filters, setFilters }
}
