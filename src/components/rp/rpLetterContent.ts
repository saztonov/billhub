import type { PaymentRequest } from '@/types'

/**
 * Автосборка содержания письма РП: «<сумма>, <поставщик>, <описание1>, <описание2>».
 * Сумма — по всем выбранным заявкам; поставщик один (связка); описания — непустые
 * комментарии заявок через запятую.
 */
export function buildRpLetterContent(requests: PaymentRequest[]): string {
  if (requests.length === 0) return ''
  const total = requests.reduce((sum, r) => sum + (r.invoiceAmount ?? 0), 0)
  const parts: string[] = [
    `${total.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`,
  ]
  const supplierName = requests[0]?.supplierName?.trim()
  if (supplierName) parts.push(supplierName)
  for (const r of requests) {
    const comment = (r.comment ?? '').trim()
    if (comment) parts.push(comment)
  }
  return parts.join(', ')
}
