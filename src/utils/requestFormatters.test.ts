import { describe, it, expect } from 'vitest'
import {
  formatSize,
  formatDate,
  formatDateShort,
  extractRequestNumber,
  calculateDays,
  sanitizeFileName,
} from './requestFormatters'

describe('formatSize', () => {
  it('пустая строка для null', () => {
    expect(formatSize(null)).toBe('')
  })

  it('байты для размера < 1 KB', () => {
    expect(formatSize(512)).toBe('512 Б')
  })

  it('килобайты для размера < 1 MB', () => {
    expect(formatSize(2048)).toBe('2.0 КБ')
  })

  it('мегабайты для размера >= 1 MB', () => {
    expect(formatSize(2 * 1024 * 1024)).toBe('2.0 МБ')
  })

  it('0 байт обрабатывается как falsy → пустая строка', () => {
    expect(formatSize(0)).toBe('')
  })
})

describe('formatDate', () => {
  it('форматирует ISO-дату в ru-RU', () => {
    const result = formatDate('2026-05-29T10:30:00Z', false)
    // ru-RU: дд.мм.гггг
    expect(result).toContain('2026')
    expect(result).toContain('05')
    expect(result).toContain('29')
  })

  it('возвращает прочерк для null', () => {
    expect(formatDate(null)).toBe('—')
  })

  it('возвращает прочерк для пустой строки', () => {
    expect(formatDate('')).toBe('—')
  })

  it('withTime=false убирает часы:минуты', () => {
    const result = formatDate('2026-05-29T10:30:00Z', false)
    expect(result).not.toMatch(/\d{1,2}:\d{2}/)
  })
})

describe('formatDateShort', () => {
  it('возвращает прочерк для null', () => {
    expect(formatDateShort(null)).toBe('—')
  })

  it('форматирует короткую дату', () => {
    const result = formatDateShort('2026-05-29T10:30:00Z')
    expect(result).toContain('05')
    expect(result).toContain('29')
  })
})

describe('extractRequestNumber', () => {
  it('извлекает порядковый номер из request_number с подчёркиванием', () => {
    expect(extractRequestNumber('00042_2026')).toBe('42')
  })

  it('возвращает строку без изменений если нет подчёркивания', () => {
    expect(extractRequestNumber('ABC-123')).toBe('ABC-123')
  })

  it('обрабатывает однопартовый префикс', () => {
    expect(extractRequestNumber('001_test_extra')).toBe('1')
  })
})

describe('calculateDays', () => {
  it('возвращает количество полных дней между датами', () => {
    expect(calculateDays('2026-05-01', '2026-05-11')).toBe(10)
  })

  it('возвращает 0 если даты совпадают', () => {
    expect(calculateDays('2026-05-01', '2026-05-01')).toBe(0)
  })

  it('toDate=null использует текущий момент (>=0 при будущей дате from)', () => {
    const result = calculateDays('2000-01-01', null)
    expect(result).toBeGreaterThan(0)
  })

  it('отрицательное значение если from > to', () => {
    expect(calculateDays('2026-05-11', '2026-05-01')).toBeLessThan(0)
  })
})

describe('sanitizeFileName', () => {
  it('удаляет последовательности .. для защиты от path traversal', () => {
    expect(sanitizeFileName('../etc/passwd')).not.toContain('..')
  })

  it('заменяет прямой слэш на подчёркивание', () => {
    expect(sanitizeFileName('folder/file.txt')).toBe('folder_file.txt')
  })

  it('заменяет обратный слэш на подчёркивание', () => {
    expect(sanitizeFileName('folder\\file.txt')).toBe('folder_file.txt')
  })

  it('возвращает "file" если результат пустой', () => {
    expect(sanitizeFileName('')).toBe('file')
  })

  it('возвращает "file" если только слэши и точки', () => {
    expect(sanitizeFileName('..')).toBe('file')
  })

  it('сохраняет кириллические имена файлов', () => {
    expect(sanitizeFileName('счёт_001.pdf')).toBe('счёт_001.pdf')
  })

  it('удаляет ведущие подчёркивания', () => {
    expect(sanitizeFileName('___test.pdf')).toBe('test.pdf')
  })
})
