import * as pdfjsLib from 'pdfjs-dist'

// URL воркера, разрешённый Vite при сборке
const workerAssetUrl = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// Промис однократной настройки воркера PDF.js
let workerSetupPromise: Promise<void> | null = null

/** Настройка воркера через Blob URL (обход MIME-type проблемы с .mjs на сервере) */
export function ensurePdfWorkerReady(): Promise<void> {
  if (!workerSetupPromise) {
    workerSetupPromise = (async () => {
      // fetch не проверяет MIME-type (в отличие от import/Worker type=module)
      const response = await fetch(workerAssetUrl)
      const workerText = await response.text()
      const blob = new Blob([workerText], { type: 'application/javascript' })
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob)
    })()
  }
  return workerSetupPromise
}

/** Подсчёт страниц PDF-файла. Возвращает null при ошибке. */
export async function getPdfPageCount(file: File): Promise<number | null> {
  try {
    await ensurePdfWorkerReady()
    const buffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
    return pdf.numPages
  } catch {
    return null
  }
}
