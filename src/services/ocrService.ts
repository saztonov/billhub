import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'

/** Прогресс распознавания */
export interface OcrProgress {
  stage: 'downloading' | 'recognizing' | 'validating' | 'saving'
  fileIndex: number
  totalFiles: number
  pageIndex?: number
  totalPages?: number
}

/** Запускает OCR-распознавание заявки на сервере */
export async function processPaymentRequestOcr(
  paymentRequestId: string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<void> {
  // Запуск OCR на сервере
  await api.post(`/api/ocr/recognize/${paymentRequestId}`)

  // Если передан callback прогресса — уведомляем о завершении
  if (onProgress) {
    onProgress({ stage: 'saving', fileIndex: 1, totalFiles: 1 })
  }
}

/** Проверяет, нужно ли автоматически запустить OCR, и добавляет в очередь */
export async function triggerOcrIfEnabled(paymentRequestId: string): Promise<void> {
  try {
    const { useOcrStore } = await import('@/store/ocrStore')
    const { autoEnabled, activeModelId } = useOcrStore.getState()
    if (!autoEnabled || !activeModelId) return

    // Динамический импорт чтобы избежать циклической зависимости
    const { useOcrQueueStore } = await import('@/store/ocrQueueStore')
    useOcrQueueStore.getState().enqueue(paymentRequestId, 'auto')
  } catch (err) {
    logError({
      errorType: 'api_error',
      errorMessage: `Ошибка автоматического OCR для заявки ${paymentRequestId}: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`,
      component: 'ocrService',
    })
  }
}
