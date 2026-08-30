import type { SavingsDetails, SavingsReport } from '@/types'

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

/** «2026-08» -> «Август 2026» */
const fmtMonth = (month: string): string => {
  const [year, mon] = month.split('-')
  const name = MONTH_NAMES[Number(mon) - 1]
  return name ? `${name} ${year}` : month
}

/** «2026-08-27» -> «27.08.2026» */
const fmtDate = (date: string): string => {
  const [year, month, day] = date.split('-')
  return day ? `${day}.${month}.${year}` : date
}

/** Денежный формат ячеек Excel */
const MONEY_FMT = '#,##0.00'

/** Строка кросс-таблицы: сотрудник и его экономия по месяцам */
interface UserRow {
  fullName: string
  byMonth: Map<string, number>
  total: number
}

/** Свод отчёта в кросс-таблицу «сотрудник × месяц» (месяцы по возрастанию) */
function buildCrossTab(report: SavingsReport): { months: string[]; users: UserRow[] } {
  const months = [...report.months].map((m) => m.month).sort()
  const byUser = new Map<string, UserRow>()

  for (const month of report.months) {
    for (const user of month.byUser) {
      const key = user.userId ?? 'unknown'
      let row = byUser.get(key)
      if (!row) {
        row = { fullName: user.fullName ?? 'Не определён', byMonth: new Map(), total: 0 }
        byUser.set(key, row)
      }
      row.byMonth.set(month.month, (row.byMonth.get(month.month) ?? 0) + user.saved)
      row.total += user.saved
    }
  }

  const users = [...byUser.values()].sort((a, b) => b.total - a.total)
  return { months, users }
}

/**
 * Книга отчёта об экономии: лист «Сводка» (кросс-таблица ФИО × месяцы)
 * и лист «Детализация» (строка на каждое снижение суммы заявки).
 */
export async function buildSavingsWorkbook(
  report: SavingsReport,
  details: SavingsDetails,
): Promise<import('exceljs').Workbook> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()

  /* ---------- Лист «Сводка»: сотрудники × месяцы ---------- */
  const { months, users } = buildCrossTab(report)
  const summary = wb.addWorksheet('Сводка')
  summary.columns = [{ width: 38 }, ...months.map(() => ({ width: 16 })), { width: 18 }]

  const title = summary.addRow(['Экономия по заявкам на оплату'])
  title.font = { bold: true, size: 14 }
  summary.addRow([`Период: ${fmtMonth(report.from)} — ${fmtMonth(report.to)}`])
  summary.addRow([])

  const header = summary.addRow(['Сотрудник', ...months.map(fmtMonth), 'Итого'])
  header.font = { bold: true }

  const firstDataRow = summary.rowCount + 1
  users.forEach((user) => {
    summary.addRow([user.fullName, ...months.map((m) => user.byMonth.get(m) ?? 0), user.total])
  })
  const totalsRow = summary.addRow([
    'Итого',
    ...months.map((m) => report.months.find((x) => x.month === m)?.saved ?? 0),
    report.total.saved,
  ])
  totalsRow.font = { bold: true }

  // Денежный формат всем числовым колонкам (со второй по последнюю)
  const lastCol = months.length + 2
  for (let row = firstDataRow; row <= totalsRow.number; row++) {
    for (let col = 2; col <= lastCol; col++) {
      summary.getCell(row, col).numFmt = MONEY_FMT
    }
  }

  /* ---------- Лист «Детализация»: строка на каждое снижение ---------- */
  const detail = wb.addWorksheet('Детализация')
  detail.columns = [
    { width: 12 }, // Дата
    { width: 12 }, // № заявки
    { width: 28 }, // Объект
    { width: 30 }, // Контрагент
    { width: 30 }, // Поставщик
    { width: 16 }, // Сумма до
    { width: 16 }, // Сумма после
    { width: 16 }, // Экономия
    { width: 38 }, // Сотрудник
  ]

  const detailHeader = detail.addRow([
    'Дата',
    '№ заявки',
    'Объект',
    'Контрагент',
    'Поставщик',
    'Сумма до',
    'Сумма после',
    'Экономия',
    'Сотрудник ОМТС',
  ])
  detailHeader.font = { bold: true }

  const firstDetailRow = detail.rowCount + 1
  details.rows.forEach((r) => {
    detail.addRow([
      fmtDate(r.date),
      r.requestNumber ?? '',
      r.siteName ?? '',
      r.counterpartyName ?? '',
      r.supplierName ?? '',
      r.amountBefore,
      r.amountAfter,
      r.saved,
      r.fullName ?? 'Не определён',
    ])
  })
  const lastDetailRow = detail.rowCount

  for (let row = firstDetailRow; row <= lastDetailRow; row++) {
    for (const col of [6, 7, 8]) {
      detail.getCell(row, col).numFmt = MONEY_FMT
    }
  }

  if (details.rows.length > 0) {
    const detailTotal = detail.addRow(['Итого', '', '', '', '', '', '', 0, ''])
    detailTotal.font = { bold: true }
    const cell = detailTotal.getCell(8)
    cell.value = {
      formula: `SUM(H${firstDetailRow}:H${lastDetailRow})`,
      result: undefined,
    } as unknown as import('exceljs').CellValue
    cell.numFmt = MONEY_FMT
  }

  return wb
}

/** Формирует книгу и отдаёт её браузеру файлом */
export async function exportSavingsReportToExcel(
  report: SavingsReport,
  details: SavingsDetails,
): Promise<void> {
  const wb = await buildSavingsWorkbook(report, details)

  const fileName = `Экономия_${report.from}_${report.to}.xlsx`
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
