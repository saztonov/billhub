import type { MaterialsRequestRow } from '@/store/materialsStore'
import { formatDate } from '@/utils/requestFormatters'

/** Экспорт таблицы счетов (вкладка Материалы) в Excel */
export async function exportMaterialsInvoicesToExcel(rows: MaterialsRequestRow[]): Promise<void> {
  const ExcelJS = await import('exceljs')

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Счета')

  // Ширина колонок
  ws.columns = [
    { width: 6 },   // №пп
    { width: 14 },  // Номер заявки
    { width: 30 },  // Подрядчик
    { width: 30 },  // Поставщик
    { width: 30 },  // Объект
    { width: 18 },  // Дата согласования
    { width: 10 },  // Счетов
    { width: 10 },  // Позиций
    { width: 16 },  // Сумма
    { width: 16 },  // Статус
  ]

  // Заголовок
  const now = new Date()
  const dateStr = now.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

  const titleRow = ws.addRow(['Счета — Материалы'])
  ws.mergeCells(titleRow.number, 1, titleRow.number, 10)

  const dateRow = ws.addRow([`Дата: ${dateStr}`])
  ws.mergeCells(dateRow.number, 1, dateRow.number, 10)

  ws.addRow([]) // Разделитель

  // Шапка таблицы
  ws.addRow([
    '№пп',
    'Номер заявки',
    'Подрядчик',
    'Поставщик',
    'Объект',
    'Дата согласования',
    'Счетов',
    'Позиций',
    'Сумма',
    'Статус',
  ])

  const firstDataRow = ws.rowCount + 1

  // Данные
  rows.forEach((r, idx) => {
    let status = '—'
    if (r.materialsVerification) {
      status = r.materialsVerification.status === 'verified' ? 'Проверен' : 'На проверке'
    }

    ws.addRow([
      idx + 1,
      r.requestNumber,
      r.counterpartyName,
      r.supplierName,
      r.siteName,
      formatDate(r.approvedAt, false),
      r.invoicesCount,
      r.itemsCount,
      r.totalAmount != null ? Number(r.totalAmount) : '',
      status,
    ])
  })

  const lastDataRow = ws.rowCount

  // Формат суммы (колонка I)
  for (let row = firstDataRow; row <= lastDataRow; row++) {
    const cell = ws.getCell(`I${row}`)
    if (typeof cell.value === 'number') {
      cell.numFmt = '#,##0.00'
    }
  }

  // Строка ИТОГО
  const totalRow = ws.addRow(['ИТОГО', '', '', '', '', '', '', '', '', ''])
  const totalCell = totalRow.getCell(9)
  totalCell.value = {
    formula: `SUM(I${firstDataRow}:I${lastDataRow})`,
    result: undefined,
  } as unknown as import('exceljs').CellValue
  totalCell.numFmt = '#,##0.00'

  // Скачивание
  const dateFile = now.toISOString().slice(0, 10)
  const fileName = `Материалы_счета_${dateFile}.xlsx`

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
