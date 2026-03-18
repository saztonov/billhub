import { useState, useEffect, useCallback } from 'react'
import { getDownloadUrl } from '@/services/s3'
import { logError } from '@/services/errorLogger'

interface InvoiceFile {
  id: string
  fileKey: string
  fileName: string
  mimeType: string | null
}

interface UseInvoiceSyncViewerResult {
  /** URL для отображения файлов */
  urls: Record<string, string>
  /** Загружаются ли URL */
  isLoading: boolean
  /** ID текущего выбранного файла */
  currentFileId: string | null
  /** Номер текущей страницы */
  currentPage: number
  /** Переключиться на файл и страницу */
  syncToMaterial: (fileId: string | null, pageNumber: number | null) => void
  /** Переключить файл вручную */
  setCurrentFileId: (id: string) => void
  /** Переключить страницу вручную */
  setCurrentPage: (page: number) => void
}

/** Хук для синхронизации просмотра скана счёта с выбранной строкой таблицы */
export function useInvoiceSyncViewer(
  files: InvoiceFile[],
  isOpen: boolean,
): UseInvoiceSyncViewerResult {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [currentFileId, setCurrentFileId] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  // Загрузка presigned URL при открытии
  useEffect(() => {
    if (!isOpen || files.length === 0) return

    let cancelled = false
    const loadUrls = async () => {
      setIsLoading(true)
      const result: Record<string, string> = {}
      for (const file of files) {
        try {
          result[file.id] = await getDownloadUrl(file.fileKey)
        } catch (err) {
          logError({
            errorType: 'api_error',
            errorMessage: `Не удалось получить URL для файла ${file.fileName}`,
            errorStack: err instanceof Error ? err.stack : null,
            component: 'useInvoiceSyncViewer',
          })
        }
      }
      if (!cancelled) {
        setUrls(result)
        setIsLoading(false)
        // Выбираем первый файл по умолчанию
        if (!currentFileId && files.length > 0) {
          setCurrentFileId(files[0].id)
        }
      }
    }
    loadUrls()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, files])

  // Синхронизация при клике на строку таблицы
  const syncToMaterial = useCallback(
    (fileId: string | null, pageNumber: number | null) => {
      if (fileId && files.some((f) => f.id === fileId)) {
        setCurrentFileId(fileId)
      }
      if (pageNumber && pageNumber > 0) {
        setCurrentPage(pageNumber)
      }
    },
    [files],
  )

  return {
    urls,
    isLoading,
    currentFileId,
    currentPage,
    syncToMaterial,
    setCurrentFileId,
    setCurrentPage,
  }
}
