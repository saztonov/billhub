import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRpLetterFiltering } from './useRpLetterFiltering'
import type { RpLetter } from '@/types'
import type { FilterValues } from '@/components/paymentRequests/RequestFilters'

/** Минимальная строка реестра для теста */
function letter(overrides: Partial<RpLetter>): RpLetter {
  return {
    id: 'id',
    number: 'РП-000001',
    letterDate: null,
    createdAt: '2026-07-01T10:00:00Z',
    status: 'draft',
    totalAmount: 1000,
    description: '',
    supplierId: 'sup-1',
    supplierName: '',
    supplierInn: '',
    counterpartyId: 'cp-1',
    counterpartyName: '',
    counterpartyInn: '',
    siteId: 'site-1',
    siteName: '',
    createdBy: 'user-1',
    requests: [],
    paymentStatus: 'unpaid',
    payhubLetterId: null,
    payhubLetterRegNumber: null,
    payhubLetterUrl: null,
    payhubLetterStatus: null,
    payhubLetterError: null,
    payhubLetterPayload: null,
    ...overrides,
  }
}

function run(letters: RpLetter[], filters: FilterValues, userId?: string) {
  return renderHook(() => useRpLetterFiltering(letters, filters, userId)).result.current
}

describe('useRpLetterFiltering', () => {
  const items = [
    letter({ id: '1', supplierId: 'sup-1', totalAmount: 500, createdBy: 'user-1' }),
    letter({
      id: '2',
      supplierId: 'sup-2',
      totalAmount: 2000,
      createdBy: 'user-2',
      number: 'РП-000002',
      payhubLetterRegNumber: 'SU10-ИСХ-2607-0007',
      requests: [{ id: 'r1', requestNumber: 'Z-42' }],
      createdAt: '2026-07-03T10:00:00Z',
    }),
  ]

  it('без фильтров возвращает всё', () => {
    expect(run(items, {})).toHaveLength(2)
  })

  it('фильтрует по поставщику/подрядчику/объекту', () => {
    expect(run(items, { supplierId: 'sup-2' }).map((l) => l.id)).toEqual(['2'])
    expect(run(items, { counterpartyId: 'нет' })).toHaveLength(0)
    expect(run(items, { siteId: 'site-1' })).toHaveLength(2)
  })

  it('фильтрует по сумме с оператором', () => {
    expect(run(items, { amountOperator: '>=', amountValue: 1000 }).map((l) => l.id)).toEqual(['2'])
    expect(run(items, { amountOperator: '<=', amountValue: 500 }).map((l) => l.id)).toEqual(['1'])
    expect(run(items, { amountOperator: '=', amountValue: 2000 }).map((l) => l.id)).toEqual(['2'])
  })

  it('поле «номер» ищет по заявке, локальному номеру РП и номеру письма PayHub', () => {
    expect(run(items, { requestNumber: 'z-42' }).map((l) => l.id)).toEqual(['2'])
    expect(run(items, { requestNumber: 'РП-000001' }).map((l) => l.id)).toEqual(['1'])
    expect(run(items, { requestNumber: 'су10-исх' })).toHaveLength(0) // латиница/кириллица различаются
    expect(run(items, { requestNumber: 'SU10-ИСХ' }).map((l) => l.id)).toEqual(['2'])
  })

  it('фильтрует по диапазону дат (dateTo — включительно)', () => {
    expect(run(items, { dateFrom: '2026-07-02' }).map((l) => l.id)).toEqual(['2'])
    expect(run(items, { dateTo: '2026-07-01' }).map((l) => l.id)).toEqual(['1'])
  })

  it('«мои» и «ответственный» — по создателю РП', () => {
    expect(run(items, { myRequestsFilter: 'assigned_to_me' }, 'user-2').map((l) => l.id)).toEqual([
      '2',
    ])
    expect(run(items, { responsibleUserId: 'user-1' }).map((l) => l.id)).toEqual(['1'])
  })

  it('responsibleFilter (назначен/не назначен) к реестру не применяется', () => {
    expect(run(items, { responsibleFilter: 'unassigned' })).toHaveLength(2)
  })
})
