import type { PaymentRequest, Supplier } from '@/types'
import { extractRequestNumber } from '@/utils/requestFormatters'

interface ExportRegistryParams {
  requests: PaymentRequest[]
  suppliers: Supplier[]
  siteName: string
  statusApprovedCode: string
  statusNotPaidCode: string
  statuses: { id: string; code: string }[]
}

/** Экспорт реестра РП на оплату в Excel */
export async function exportRegistryToExcel(params: ExportRegistryParams): Promise<void> {
  const { requests, suppliers, siteName, statusApprovedCode, statusNotPaidCode, statuses } = params

  // Динамический импорт ExcelJS для уменьшения бандла
  const ExcelJS = await import('exceljs')

  // Находим id статусов по коду
  const approvedStatusId = statuses.find(s => s.code === statusApprovedCode)?.id
  const notPaidStatusId = statuses.find(s => s.code === statusNotPaidCode)?.id

  // Фильтрация: Согласовано + Не оплачено (null или not_paid)
  const filtered = requests.filter(r => {
    const isApproved = r.statusId === approvedStatusId
    const isNotPaid = r.paidStatusId === null || r.paidStatusId === notPaidStatusId
    return isApproved && isNotPaid
  })

  // Маппинг ИНН поставщиков
  const supplierInnMap = new Map<string, string>()
  for (const s of suppliers) {
    supplierInnMap.set(s.id, s.inn)
  }

  // Дата реестра
  const now = new Date()
  const dateStr = now.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

  // Создаём книгу и лист
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Реестр')

  // Ширина колонок
  ws.columns = [
    { width: 6 },   // №пп
    { width: 12 },  // № заявки
    { width: 30 },  // Подрядчик
    { width: 30 },  // Поставщик
    { width: 14 },  // ИНН
    { width: 15 },  // Сумма
    { width: 40 },  // Описание
  ]

  // Заголовки
  const titleRow = ws.addRow(['РЕЕСТР РП НА ОПЛАТУ'])
  ws.mergeCells(titleRow.number, 1, titleRow.number, 7)

  const siteRow = ws.addRow([`Объект: ${siteName}`])
  ws.mergeCells(siteRow.number, 1, siteRow.number, 7)

  const dateRow = ws.addRow([`Дата реестра: ${dateStr}`])
  ws.mergeCells(dateRow.number, 1, dateRow.number, 7)

  ws.addRow([]) // Пустая строка-разделитель
  ws.addRow(['№пп', '№ заявки', 'Подрядчик', 'Поставщик', 'ИНН', 'Сумма', 'Описание'])

  const firstDataRow = ws.rowCount + 1

  // Данные
  filtered.forEach((r, idx) => {
    ws.addRow([
      idx + 1,
      extractRequestNumber(r.requestNumber),
      r.counterpartyName ?? '',
      r.supplierName ?? '',
      r.supplierId ? (supplierInnMap.get(r.supplierId) ?? '') : '',
      r.invoiceAmount != null ? Number(r.invoiceAmount) : '',
      r.comment ?? '',
    ])
  })

  const lastDataRow = ws.rowCount

  // Формат суммы для столбца F
  for (let row = firstDataRow; row <= lastDataRow; row++) {
    const cell = ws.getCell(`F${row}`)
    if (typeof cell.value === 'number') {
      cell.numFmt = '#,##0.00'
    }
  }

  // Строка ИТОГО с формулой SUM
  const totalRow = ws.addRow(['ИТОГО', '', '', '', '', '', ''])
  const totalCell = totalRow.getCell(6)
  totalCell.value = { formula: `SUM(F${firstDataRow}:F${lastDataRow})`, result: undefined } as unknown as import('exceljs').CellValue
  totalCell.numFmt = '#,##0.00'

  // Скачиваем
  const safeSiteName = siteName.replace(/[\\/:*?"<>|]/g, '_')
  const dateFile = now.toISOString().slice(0, 10)
  const fileName = `Реестр_заявок_${safeSiteName}_${dateFile}.xlsx`

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
