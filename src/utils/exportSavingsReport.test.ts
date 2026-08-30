import { describe, it, expect } from 'vitest'
import { buildSavingsWorkbook } from './exportSavingsReport'
import type { SavingsDetails, SavingsReport } from '@/types'

const REPORT: SavingsReport = {
  from: '2026-07',
  to: '2026-08',
  total: { count: 4, saved: 3000 },
  months: [
    {
      month: '2026-08',
      count: 3,
      saved: 2000,
      byUser: [
        { userId: 'u1', fullName: 'Иванов И.И.', count: 2, saved: 1500 },
        { userId: 'u2', fullName: 'Петров П.П.', count: 1, saved: 500 },
      ],
    },
    {
      month: '2026-07',
      count: 1,
      saved: 1000,
      byUser: [{ userId: 'u1', fullName: 'Иванов И.И.', count: 1, saved: 1000 }],
    },
  ],
}

const DETAILS: SavingsDetails = {
  from: '2026-07',
  to: '2026-08',
  rows: [
    {
      date: '2026-08-27',
      requestNumber: '1163',
      siteName: 'ЖК Волна',
      counterpartyName: 'ООО Подрядчик',
      supplierName: 'ООО Поставщик',
      amountBefore: 15160,
      amountAfter: 13660,
      saved: 1500,
      fullName: 'Иванов И.И.',
    },
    {
      date: '2026-07-10',
      requestNumber: '1100',
      siteName: 'ЖК Волна',
      counterpartyName: 'ООО Подрядчик',
      supplierName: null,
      amountBefore: 5000,
      amountAfter: 4000,
      saved: 1000,
      fullName: null,
    },
  ],
}

// exceljs подгружается динамически — первый импорт в jsdom заметно дольше дефолтных 5 с
const TIMEOUT_MS = 30_000

describe('buildSavingsWorkbook', () => {
  it(
    'лист «Сводка»: месяцы по возрастанию, сотрудники по убыванию экономии, итоги',
    async () => {
      const wb = await buildSavingsWorkbook(REPORT, DETAILS)
      const ws = wb.getWorksheet('Сводка')!

      expect(ws.getCell('A2').value).toBe('Период: Июль 2026 — Август 2026')

      // Шапка: сотрудник, месяцы в хронологическом порядке, итог
      expect(ws.getRow(4).values).toEqual([
        undefined,
        'Сотрудник',
        'Июль 2026',
        'Август 2026',
        'Итого',
      ])

      // Иванов заработал больше — первой строкой; месяц без данных = 0
      expect(ws.getRow(5).values).toEqual([undefined, 'Иванов И.И.', 1000, 1500, 2500])
      expect(ws.getRow(6).values).toEqual([undefined, 'Петров П.П.', 0, 500, 500])

      // Итоговая строка совпадает с помесячными суммами и общим итогом отчёта
      expect(ws.getRow(7).values).toEqual([undefined, 'Итого', 1000, 2000, 3000])
    },
    TIMEOUT_MS,
  )

  it(
    'лист «Детализация»: строки с ФИО и итоговая формула по экономии',
    async () => {
      const wb = await buildSavingsWorkbook(REPORT, DETAILS)
      const ws = wb.getWorksheet('Детализация')!

      expect(ws.getRow(1).getCell(9).value).toBe('Сотрудник ОМТС')
      expect(ws.getRow(2).values).toEqual([
        undefined,
        '27.08.2026',
        '1163',
        'ЖК Волна',
        'ООО Подрядчик',
        'ООО Поставщик',
        15160,
        13660,
        1500,
        'Иванов И.И.',
      ])
      // Пустое ФИО подписывается явно, отсутствующий поставщик — пустой ячейкой
      expect(ws.getRow(3).getCell(9).value).toBe('Не определён')
      expect(ws.getRow(3).getCell(5).value).toBe('')

      const totalCell = ws.getRow(4).getCell(8).value as { formula: string }
      expect(totalCell.formula).toBe('SUM(H2:H3)')
    },
    TIMEOUT_MS,
  )

  it(
    'пустой отчёт: книга собирается без строк данных',
    async () => {
      const empty: SavingsReport = {
        from: '2026-07',
        to: '2026-08',
        total: { count: 0, saved: 0 },
        months: [],
      }
      const wb = await buildSavingsWorkbook(empty, { from: '2026-07', to: '2026-08', rows: [] })
      expect(wb.getWorksheet('Сводка')!.getRow(5).values).toEqual([undefined, 'Итого', 0])
      expect(wb.getWorksheet('Детализация')!.rowCount).toBe(1)
    },
    TIMEOUT_MS,
  )
})
