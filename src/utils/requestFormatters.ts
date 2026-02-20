/** Форматирование размера файла */
export function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

/** Форматирование даты */
export function formatDate(dateStr: string | null, withTime = true): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const opts: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }
  if (withTime) {
    opts.hour = '2-digit'
    opts.minute = '2-digit'
  }
  return d.toLocaleDateString('ru-RU', opts)
}

/** Форматирование даты (только день.месяц) */
export function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
  })
}

/** Извлечение порядкового номера из request_number */
export function extractRequestNumber(requestNumber: string): string {
  const parts = requestNumber.split('_')
  if (parts.length > 1) {
    return parseInt(parts[0], 10).toString()
  }
  return requestNumber
}

/** Расчет количества дней между двумя датами */
export function calculateDays(fromDate: string, toDate: string | null): number {
  const from = new Date(fromDate)
  const to = toDate ? new Date(toDate) : new Date()
  const diffMs = to.getTime() - from.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

/** Санитизация имени файла (защита от path traversal / ZipSlip) */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/\.\./g, '')
    .replace(/[\\\/]/g, '_')
    .replace(/^_+/, '')
    || 'file'
}
