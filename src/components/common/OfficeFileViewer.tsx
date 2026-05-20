import { useEffect, useMemo, useState } from 'react'
import { Spin, Tabs, Typography, Empty } from 'antd'
import ExcelJS from 'exceljs'
import { downloadFileBlob } from '@/services/s3'
import { logError } from '@/services/errorLogger'

const { Text } = Typography

// Источник данных для просмотрщика
export type OfficeFileSource =
  | { type: 'key'; fileKey: string }
  | { type: 'file'; file: File }

interface OfficeFileViewerProps {
  source: OfficeFileSource | null
  fileName: string
  height?: string | number
}

// Извлечение расширения файла в нижнем регистре
function getExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx < 0 || idx === name.length - 1) return ''
  return name.slice(idx + 1).toLowerCase()
}

// Получение ArrayBuffer из источника
async function getArrayBuffer(source: OfficeFileSource): Promise<ArrayBuffer> {
  if (source.type === 'file') {
    return source.file.arrayBuffer()
  }
  const blob = await downloadFileBlob(source.fileKey)
  return blob.arrayBuffer()
}

// Простая ячейка для рендера в HTML-таблице
interface RenderedCell {
  value: string
  rowSpan: number
  colSpan: number
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
  fill: string | null
}

interface RenderedSheet {
  name: string
  columnWidths: number[]
  rows: Array<Array<RenderedCell | null>>
}

// Преобразование значения ячейки ExcelJS в строку
function cellValueToString(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toLocaleDateString('ru-RU')
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((p) => p.text).join('')
    if ('text' in v && typeof (v as { text?: unknown }).text === 'string') return String((v as { text: string }).text)
    if ('result' in v) {
      const r = (v as { result?: unknown }).result
      if (r != null) return String(r)
      return ''
    }
    if ('formula' in v) return ''
  }
  return ''
}

// Рендер xlsx/xls листов в простой структурированный вид
function workbookToSheets(workbook: ExcelJS.Workbook): RenderedSheet[] {
  const sheets: RenderedSheet[] = []

  workbook.worksheets.forEach((ws) => {
    const rowCount = ws.actualRowCount || ws.rowCount || 0
    const colCount = ws.actualColumnCount || ws.columnCount || 0

    // Ширины колонок (в пикселях, базовое преобразование)
    const widths: number[] = []
    for (let c = 1; c <= colCount; c += 1) {
      const col = ws.getColumn(c)
      const w = col && typeof col.width === 'number' ? col.width : 10
      widths.push(Math.round(w * 7))
    }

    // Карта пропускаемых ячеек (continuation объединённых)
    const skip: boolean[][] = Array.from({ length: rowCount + 1 }, () => new Array(colCount + 1).fill(false))

    // Обработка объединённых ячеек
    const merges = (ws as unknown as { _merges?: Record<string, { top: number; left: number; bottom: number; right: number }> })._merges
    const mergeRanges: Array<{ top: number; left: number; bottom: number; right: number }> = []
    if (merges) {
      Object.values(merges).forEach((m) => mergeRanges.push(m))
    }
    mergeRanges.forEach((m) => {
      for (let r = m.top; r <= m.bottom; r += 1) {
        for (let c = m.left; c <= m.right; c += 1) {
          if (r === m.top && c === m.left) continue
          if (skip[r]) skip[r][c] = true
        }
      }
    })

    const rows: Array<Array<RenderedCell | null>> = []
    for (let r = 1; r <= rowCount; r += 1) {
      const rowCells: Array<RenderedCell | null> = []
      for (let c = 1; c <= colCount; c += 1) {
        if (skip[r] && skip[r][c]) {
          rowCells.push(null)
          continue
        }
        const cell = ws.getCell(r, c)
        const merge = mergeRanges.find((m) => m.top === r && m.left === c)
        const rowSpan = merge ? merge.bottom - merge.top + 1 : 1
        const colSpan = merge ? merge.right - merge.left + 1 : 1
        const font = cell.font || {}
        const alignment = cell.alignment || {}
        const fillObj = cell.fill as ExcelJS.FillPattern | undefined
        let fillColor: string | null = null
        if (fillObj && fillObj.type === 'pattern' && fillObj.fgColor && 'argb' in fillObj.fgColor && fillObj.fgColor.argb) {
          const argb = fillObj.fgColor.argb
          fillColor = `#${argb.slice(2)}`
        }
        const align: 'left' | 'center' | 'right' =
          alignment.horizontal === 'center' ? 'center'
          : alignment.horizontal === 'right' ? 'right'
          : 'left'
        rowCells.push({
          value: cellValueToString(cell),
          rowSpan,
          colSpan,
          bold: !!font.bold,
          italic: !!font.italic,
          align,
          fill: fillColor,
        })
      }
      rows.push(rowCells)
    }

    sheets.push({ name: ws.name || `Лист ${sheets.length + 1}`, columnWidths: widths, rows })
  })

  return sheets
}

// Рендер одного листа Excel как HTML-таблицы
function ExcelSheetTable({ sheet, height }: { sheet: RenderedSheet; height: string | number }) {
  return (
    <div style={{ overflow: 'auto', maxHeight: height, border: '1px solid #f0f0f0' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 13, fontFamily: 'Calibri, Arial, sans-serif' }}>
        <colgroup>
          {sheet.columnWidths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <tbody>
          {sheet.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => {
                if (cell === null) return null
                return (
                  <td
                    key={ci}
                    rowSpan={cell.rowSpan}
                    colSpan={cell.colSpan}
                    style={{
                      border: '1px solid #e0e0e0',
                      padding: '4px 8px',
                      verticalAlign: 'top',
                      textAlign: cell.align,
                      fontWeight: cell.bold ? 600 : 400,
                      fontStyle: cell.italic ? 'italic' : 'normal',
                      background: cell.fill || undefined,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {cell.value}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const OfficeFileViewer = ({ source, fileName, height = '70vh' }: OfficeFileViewerProps) => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheets, setSheets] = useState<RenderedSheet[] | null>(null)
  const [xlsHtmlSheets, setXlsHtmlSheets] = useState<Array<{ name: string; html: string }> | null>(null)
  const [docxHtml, setDocxHtml] = useState<string | null>(null)

  const ext = useMemo(() => getExtension(fileName), [fileName])

  useEffect(() => {
    let cancelled = false
    setSheets(null)
    setXlsHtmlSheets(null)
    setDocxHtml(null)
    setError(null)

    if (!source) return
    // Старый бинарный .doc — не рендерим, показываем заглушку
    if (ext === 'doc') return
    if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'docx') return

    setLoading(true)
    ;(async () => {
      try {
        const buffer = await getArrayBuffer(source)
        if (cancelled) return

        if (ext === 'xlsx') {
          // OOXML — рендер через ExcelJS с богатым форматированием
          const wb = new ExcelJS.Workbook()
          await wb.xlsx.load(buffer)
          if (cancelled) return
          const result = workbookToSheets(wb)
          setSheets(result)
        } else if (ext === 'xls') {
          // Старый бинарный BIFF — ExcelJS не умеет, используем SheetJS с lazy-import.
          // SheetJS также читает HTML-таблицы, сохранённые как .xls (часто из 1С/Excel).
          const xlsxMod = await import('xlsx')
          if (cancelled) return
          const XLSX = (xlsxMod as unknown as { default?: typeof xlsxMod }).default ?? xlsxMod
          const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
          const htmlSheets = wb.SheetNames.map((name) => ({
            name,
            html: XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false }),
          }))
          setXlsHtmlSheets(htmlSheets)
        } else if (ext === 'docx') {
          // mammoth подгружается лениво для уменьшения начального бандла
          const mammothMod = await import('mammoth')
          if (cancelled) return
          // Vite оборачивает CJS-экспорт mammoth — namespace содержит convertToHtml как named-экспорт,
          // fallback на default — на случай других вариантов CJS/ESM-обёрток
          const convertToHtml = mammothMod.convertToHtml
            ?? (mammothMod as unknown as { default: typeof mammothMod }).default.convertToHtml
          const r = await convertToHtml({ arrayBuffer: buffer })
          setDocxHtml(r.value || '')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Не удалось открыть файл'
        logError({
          errorType: 'api_error',
          errorMessage: msg,
          errorStack: err instanceof Error ? err.stack : null,
          metadata: { action: 'OfficeFileViewer.load', fileName },
        })
        if (!cancelled) setError(msg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [source, ext, fileName])

  if (ext === 'doc') {
    return (
      <Empty
        description={
          <Text type="secondary">
            Предпросмотр .doc недоступен. Скачайте файл, чтобы открыть его в Word.
          </Text>
        }
        style={{ padding: 40 }}
      />
    )
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Text type="danger">{error}</Text>
      </div>
    )
  }

  if (sheets && sheets.length > 0) {
    if (sheets.length === 1) {
      return <ExcelSheetTable sheet={sheets[0]} height={height} />
    }
    return (
      <Tabs
        items={sheets.map((s, i) => ({
          key: String(i),
          label: s.name,
          children: <ExcelSheetTable sheet={s} height={height} />,
        }))}
      />
    )
  }

  if (xlsHtmlSheets && xlsHtmlSheets.length > 0) {
    const renderXlsSheet = (html: string) => (
      <div
        style={{
          overflow: 'auto',
          maxHeight: height,
          border: '1px solid #f0f0f0',
          padding: 8,
          fontSize: 13,
          fontFamily: 'Calibri, Arial, sans-serif',
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
    if (xlsHtmlSheets.length === 1) {
      return renderXlsSheet(xlsHtmlSheets[0].html)
    }
    return (
      <Tabs
        items={xlsHtmlSheets.map((s, i) => ({
          key: String(i),
          label: s.name,
          children: renderXlsSheet(s.html),
        }))}
      />
    )
  }

  if (docxHtml != null) {
    return (
      <div
        style={{
          overflow: 'auto',
          maxHeight: height,
          padding: 24,
          background: '#fff',
          border: '1px solid #f0f0f0',
          fontFamily: 'Calibri, Arial, sans-serif',
          fontSize: 14,
          lineHeight: 1.5,
        }}
        dangerouslySetInnerHTML={{ __html: docxHtml }}
      />
    )
  }

  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <Text type="secondary">Предпросмотр недоступен для этого типа файла</Text>
    </div>
  )
}

export default OfficeFileViewer
