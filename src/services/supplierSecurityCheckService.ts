import { api } from '@/services/api'
import type { SupplierSecurityCheck } from '@/types'

/** Получить полную историю событий проверки СБ для поставщика */
export async function fetchSecurityChecks(supplierId: string): Promise<SupplierSecurityCheck[]> {
  const data = await api.get<SupplierSecurityCheck[]>(
    `/api/references/suppliers/${supplierId}/security-checks`,
  )
  return data ?? []
}

/** Отправить поставщика на проверку СБ (admin/user) */
export async function sendForSecurityReview(supplierId: string): Promise<void> {
  await api.post(`/api/references/suppliers/${supplierId}/security-checks/request`)
}

/** Зарегистрировать решение СБ (security): согласовано/отклонено */
export async function submitSecurityDecision(
  supplierId: string,
  decision: 'approved' | 'rejected',
  comment: string,
): Promise<void> {
  await api.post(`/api/references/suppliers/${supplierId}/security-checks/decision`, {
    decision,
    comment,
  })
}
