import * as pdfjsLib from 'pdfjs-dist'

// Настройка воркера для Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

/** Подсчёт страниц PDF-файла. Возвращает null при ошибке. */
export async function getPdfPageCount(file: File): Promise<number | null> {
  try {
    const buffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
    return pdf.numPages
  } catch {
    return null
  }
}
