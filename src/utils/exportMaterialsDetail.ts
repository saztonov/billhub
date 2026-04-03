import type { RecognizedMaterial } from '@/types'

interface ExportParams {
  materials: RecognizedMaterial[]
  requestNumber: string
  counterpartyName: string
  supplierName: string
  siteName: string
  approvedAt: string | null
}

/** Форматирование даты для заголовка */
const fmtDate = (v: string | null): string => {
  if (!v) return '—'
  const d = new Date(v)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Экспорт распознанных материалов заявки в Excel */
export async function exportMaterialsDetailToExcel(params: ExportParams): Promise<void> {
  const { materials, requestNumber, counterpartyName, supplierName, siteName, approvedAt } = params

  const ExcelJS = await import('exceljs')

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Материалы')

  // Ширина колонок
  ws.columns = [
    { width: 6 },   // №
    { width: 16 },  // Артикул
    { width: 50 },  // Наименование
    { width: 12 },  // Ед.изм.
    { width: 14 },  // Количество
    { width: 14 },  // Цена
    { width: 16 },  // Сумма
    { width: 14 },  // Кол-во смета
  ]

  // Заголовок
  const titleRow = ws.addRow([`Материалы заявки ${requestNumber}`])
  ws.mergeCells(titleRow.number, 1, titleRow.number, 8)

  ws.addRow([`Подрядчик: ${counterpartyName}`])
  ws.mergeCells(ws.rowCount, 1, ws.rowCount, 8)

  ws.addRow([`Поставщик: ${supplierName}`])
  ws.mergeCells(ws.rowCount, 1, ws.rowCount, 8)

  ws.addRow([`Объект: ${siteName}`])
  ws.mergeCells(ws.rowCount, 1, ws.rowCount, 8)

  ws.addRow([`Дата согласования: ${fmtDate(approvedAt)}`])
  ws.mergeCells(ws.rowCount, 1, ws.rowCount, 8)

  ws.addRow([]) // Разделитель

  // Шапка таблицы
  ws.addRow(['№', 'Артикул', 'Наименование', 'Ед.изм.', 'Количество', 'Цена', 'Сумма', 'Кол-во смета'])

  const firstDataRow = ws.rowCount + 1

  // Данные
  materials.forEach((m) => {
    ws.addRow([
      m.position,
      m.article ?? '',
      m.materialName ?? '',
      m.materialUnit ?? '',
      m.quantity != null ? Number(m.quantity) : '',
      m.price != null ? Number(m.price) : '',
      m.amount != null ? Number(m.amount) : '',
      m.estimateQuantity != null ? Number(m.estimateQuantity) : '',
    ])
  })

  const lastDataRow = ws.rowCount

  // Числовой формат для колонок E, F, G, H
  for (let row = firstDataRow; row <= lastDataRow; row++) {
    for (const col of ['E', 'F', 'G', 'H']) {
      const cell = ws.getCell(`${col}${row}`)
      if (typeof cell.value === 'number') {
        cell.numFmt = '#,##0.00'
      }
    }
  }

  // Строка ИТОГО с формулой SUM по колонке Сумма (G)
  const totalRow = ws.addRow(['ИТОГО', '', '', '', '', '', '', ''])
  const totalCell = totalRow.getCell(7)
  totalCell.value = {
    formula: `SUM(G${firstDataRow}:G${lastDataRow})`,
    result: undefined,
  } as unknown as import('exceljs').CellValue
  totalCell.numFmt = '#,##0.00'

  // Скачивание
  const safeNumber = requestNumber.replace(/[\\/:*?"<>|]/g, '_')
  const dateFile = new Date().toISOString().slice(0, 10)
  const fileName = `Материалы_${safeNumber}_${dateFile}.xlsx`

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
