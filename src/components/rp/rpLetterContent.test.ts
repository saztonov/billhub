import { describe, it, expect } from 'vitest'
import { buildRpLetterContent } from './rpLetterContent'
import type { PaymentRequest } from '@/types'

/** Частичная заявка для теста автосборки */
const req = (invoiceAmount: number | null, supplierName: string, comment: string | null) =>
  ({ invoiceAmount, supplierName, comment }) as unknown as PaymentRequest

/** Ожидаемая сумма — той же локалью (разделитель тысяч — неразрывный пробел) */
const rub = (v: number) =>
  `${v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`

describe('buildRpLetterContent', () => {
  it('одна заявка: сумма, поставщик, описание через запятую', () => {
    expect(buildRpLetterContent([req(150000, 'ООО Ромашка', 'поставка бетона')])).toBe(
      `${rub(150000)}, ООО Ромашка, поставка бетона`,
    )
  })

  it('несколько заявок: сумма по всем, поставщик один, описания через запятую', () => {
    const result = buildRpLetterContent([
      req(100000.5, 'ООО Ромашка', 'бетон'),
      req(50000, 'ООО Ромашка', 'арматура'),
    ])
    expect(result).toBe(`${rub(150000.5)}, ООО Ромашка, бетон, арматура`)
  })

  it('пустые комментарии и суммы пропускаются', () => {
    const result = buildRpLetterContent([
      req(null, 'ООО Ромашка', '  '),
      req(1000, 'ООО Ромашка', null),
    ])
    expect(result).toBe(`${rub(1000)}, ООО Ромашка`)
  })

  it('пустой список — пустая строка', () => {
    expect(buildRpLetterContent([])).toBe('')
  })
})
