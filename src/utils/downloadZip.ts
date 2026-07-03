import { downloadFileBlob } from '@/services/s3'
import { sanitizeFileName } from '@/utils/requestFormatters'

/** Описание файла для упаковки в ZIP. */
export interface ZipFile {
  fileKey: string
  fileName: string
}

/**
 * Скачивает набор файлов и упаковывает их в ZIP-архив (динамический импорт jszip).
 * Устойчиво к ошибкам отдельных файлов (Promise.allSettled). Имена файлов санитизируются.
 * Возвращает число успешно добавленных файлов.
 */
export async function downloadFilesAsZip(files: ZipFile[], archiveName: string): Promise<number> {
  if (files.length === 0) return 0
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const results = await Promise.allSettled(
    files.map(async (file) => {
      const blob = await downloadFileBlob(file.fileKey)
      zip.file(sanitizeFileName(file.fileName), blob)
    }),
  )
  const added = results.filter((r) => r.status === 'fulfilled').length
  if (added === 0) return 0

  const content = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(content)
  const a = document.createElement('a')
  a.href = url
  a.download = sanitizeFileName(archiveName.endsWith('.zip') ? archiveName : `${archiveName}.zip`)
  a.click()
  URL.revokeObjectURL(url)
  return added
}
