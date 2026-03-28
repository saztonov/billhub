// pdfjs-dist загружается динамически для уменьшения бандла

// Кэш загруженного модуля
let pdfjsModule: typeof import('pdfjs-dist') | null = null

/** Ленивая загрузка pdfjs-dist */
async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsModule) return pdfjsModule
  pdfjsModule = await import('pdfjs-dist')
  return pdfjsModule
}

// Промис однократной настройки воркера PDF.js
let workerSetupPromise: Promise<void> | null = null

/** Настройка воркера через Blob URL (обход MIME-type проблемы с .mjs на сервере) */
export function ensurePdfWorkerReady(): Promise<void> {
  if (!workerSetupPromise) {
    workerSetupPromise = (async () => {
      const pdfjsLib = await loadPdfjs()
      // URL воркера, разрешённый Vite при сборке
      const workerAssetUrl = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString()
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
    const pdfjsLib = await loadPdfjs()
    const buffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
    return pdf.numPages
  } catch {
    return null
  }
}
