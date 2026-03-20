import * as XLSX from 'xlsx'
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
export function exportRegistryToExcel(params: ExportRegistryParams): void {
  const { requests, suppliers, siteName, statusApprovedCode, statusNotPaidCode, statuses } = params

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

  // Формируем данные
  const headerRows = [
    ['РЕЕСТР РП НА ОПЛАТУ'],
    [`Объект: ${siteName}`],
    [`Дата реестра: ${dateStr}`],
    [], // Пустая строка-разделитель
    ['№пп', '№ заявки', 'Подрядчик', 'Поставщик', 'ИНН', 'Сумма', 'Описание'],
  ]

  const dataRows = filtered.map((r, idx) => [
    idx + 1,
    extractRequestNumber(r.requestNumber),
    r.counterpartyName ?? '',
    r.supplierName ?? '',
    r.supplierId ? (supplierInnMap.get(r.supplierId) ?? '') : '',
    r.invoiceAmount != null ? Number(r.invoiceAmount) : '',
    r.comment ?? '',
  ])

  // Строка ИТОГО (сумма будет добавлена формулой)
  const totalRow = ['ИТОГО', '', '', '', '', '', '']

  const allRows = [...headerRows, ...dataRows, totalRow]

  // Создаём книгу
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(allRows)

  // Форматирование столбца "Сумма" — денежный формат (колонка F)
  const firstDataRow = headerRows.length
  const totalRowIdx = headerRows.length + dataRows.length
  const amountCol = 'F'

  for (let row = firstDataRow; row < totalRowIdx; row++) {
    const cellRef = `${amountCol}${row + 1}`
    if (ws[cellRef] && typeof ws[cellRef].v === 'number') {
      ws[cellRef].z = '#,##0.00'
    }
  }

  // Формула SUM и формат для строки ИТОГО
  const totalCellRef = `${amountCol}${totalRowIdx + 1}`
  ws[totalCellRef] = {
    t: 'n',
    f: `SUM(${amountCol}${firstDataRow + 1}:${amountCol}${totalRowIdx})`,
    z: '#,##0.00',
  }

  // Ширина колонок
  ws['!cols'] = [
    { wch: 6 },   // №пп
    { wch: 12 },  // № заявки
    { wch: 30 },  // Подрядчик
    { wch: 30 },  // Поставщик
    { wch: 14 },  // ИНН
    { wch: 15 },  // Сумма
    { wch: 40 },  // Описание
  ]

  // Объединяем ячейки заголовка
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, // РЕЕСТР РП НА ОПЛАТУ
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } }, // Объект
    { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } }, // Дата реестра
  ]

  XLSX.utils.book_append_sheet(wb, ws, 'Реестр')

  // Скачиваем
  const safeSiteName = siteName.replace(/[\\/:*?"<>|]/g, '_')
  const dateFile = now.toISOString().slice(0, 10)
  const fileName = `Реестр_заявок_${safeSiteName}_${dateFile}.xlsx`

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
