import { api } from '@/services/api'
import type { CounterpartySecurityCheck } from '@/types'

/** Получить полную историю событий проверки СБ для контрагента */
export async function fetchSecurityChecks(counterpartyId: string): Promise<CounterpartySecurityCheck[]> {
  const data = await api.get<CounterpartySecurityCheck[]>(
    `/api/references/counterparties/${counterpartyId}/security-checks`,
  )
  return data ?? []
}

/** Отправить контрагента на проверку СБ (admin/user) */
export async function sendForSecurityReview(counterpartyId: string): Promise<void> {
  await api.post(`/api/references/counterparties/${counterpartyId}/security-checks/request`)
}

/** Зарегистрировать решение СБ (security): согласовано/отклонено */
export async function submitSecurityDecision(
  counterpartyId: string,
  decision: 'approved' | 'rejected',
  comment: string,
): Promise<void> {
  await api.post(`/api/references/counterparties/${counterpartyId}/security-checks/decision`, {
    decision,
    comment,
  })
}
