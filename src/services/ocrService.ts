import { supabase } from '@/services/supabase'
import { downloadFileBlob } from '@/services/s3'
import { recognizeInvoiceStructured } from '@/services/openrouter'
import { logError } from '@/services/errorLogger'
import type { OcrParsedItem, OcrModelSetting } from '@/types'

// ID типа документа "Счет"
const INVOICE_DOC_TYPE_ID = 'c3c0b242-8a0c-4e20-b9ad-363ebf462a5b'

// Допуск при проверке суммы (quantity * price vs amount)
const AMOUNT_TOLERANCE = 0.01

// Задержка между запросами к API (мс)
const API_DELAY_MS = 500

/** Прогресс распознавания */
export interface OcrProgress {
  stage: 'downloading' | 'recognizing' | 'validating' | 'saving'
  fileIndex: number
  totalFiles: number
  pageIndex?: number
  totalPages?: number
}

/** Загружает настройки OCR из БД */
async function loadOcrSettings(): Promise<{
  autoEnabled: boolean
  activeModelId: string
  models: OcrModelSetting[]
}> {
  const { data, error } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['ocr_auto_enabled', 'ocr_active_model_id', 'ocr_models'])
  if (error) throw error

  const settings: Record<string, unknown> = {}
  for (const row of data ?? []) {
    settings[row.key as string] = row.value
  }

  const autoVal = settings['ocr_auto_enabled'] as { enabled?: boolean } | undefined
  const modelVal = settings['ocr_active_model_id'] as { modelId?: string } | undefined
  const modelsVal = settings['ocr_models'] as { models?: OcrModelSetting[] } | undefined

  return {
    autoEnabled: autoVal?.enabled ?? false,
    activeModelId: modelVal?.modelId ?? '',
    models: modelsVal?.models ?? [],
  }
}

/** Конвертирует Blob в base64 data URL */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/** Настройка локального воркера PDF.js */
function setupPdfWorker(pdfjsLib: typeof import('pdfjs-dist')): void {
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
  }
}

/** Рендерит страницу PDF в base64 изображение */
async function renderPdfPage(pdfData: ArrayBuffer, pageNum: number): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  setupPdfWorker(pdfjsLib)

  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise
  const page = await pdf.getPage(pageNum)

  // Масштаб для получения изображения ~2048px по большей стороне
  const viewport = page.getViewport({ scale: 1 })
  const maxDim = Math.max(viewport.width, viewport.height)
  const scale = Math.min(2048 / maxDim, 2)
  const scaledViewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = scaledViewport.width
  canvas.height = scaledViewport.height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Не удалось создать canvas context')

  await page.render({ canvasContext: ctx, viewport: scaledViewport, canvas } as unknown as Parameters<typeof page.render>[0]).promise
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)

  // Очистка
  canvas.width = 0
  canvas.height = 0

  return dataUrl
}

/** Получает количество страниц PDF */
async function getPdfPageCount(pdfData: ArrayBuffer): Promise<number> {
  const pdfjsLib = await import('pdfjs-dist')
  setupPdfWorker(pdfjsLib)
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise
  return pdf.numPages
}

/** Проверяет расхождение суммы */
function validateAmounts(items: OcrParsedItem[]): OcrParsedItem[] {
  const mismatched: OcrParsedItem[] = []
  for (const item of items) {
    if (item.quantity != null && item.price != null && item.amount != null) {
      const expected = item.quantity * item.price
      if (Math.abs(expected - item.amount) > AMOUNT_TOLERANCE) {
        mismatched.push(item)
      }
    }
  }
  return mismatched
}

/** Создает подсказку для повторного распознавания */
function buildRetryHint(mismatched: OcrParsedItem[]): string {
  const lines = mismatched.map((item) =>
    `Строка "${item.name}": количество=${item.quantity}, цена=${item.price}, сумма=${item.amount}, ожидаемая сумма=${((item.quantity ?? 0) * (item.price ?? 0)).toFixed(2)}. Перепроверь значения.`,
  )
  return `В предыдущей попытке обнаружены расхождения quantity*price != amount для следующих строк:\n${lines.join('\n')}\nПерепроверь эти строки особенно внимательно.`
}

/** Ищет или создает запись в справочнике материалов */
async function findOrCreateMaterial(name: string, unit: string | null): Promise<string> {
  // Поиск
  let query = supabase
    .from('materials_dictionary')
    .select('id')
    .eq('name', name)

  if (unit) {
    query = query.eq('unit', unit)
  } else {
    query = query.is('unit', null)
  }

  const { data } = await query.limit(1)
  if (data && data.length > 0) {
    return (data[0] as Record<string, unknown>).id as string
  }

  // Создание
  const insertData: Record<string, unknown> = { name }
  if (unit) insertData.unit = unit

  const { data: newData, error } = await supabase
    .from('materials_dictionary')
    .insert(insertData)
    .select('id')
    .single()
  if (error) {
    // Возможна гонка — попробуем еще раз найти
    const { data: retryData } = await query.limit(1)
    if (retryData && retryData.length > 0) {
      return (retryData[0] as Record<string, unknown>).id as string
    }
    throw error
  }
  return (newData as Record<string, unknown>).id as string
}

/** Основная функция: распознать все счета заявки */
export async function processPaymentRequestOcr(
  paymentRequestId: string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<void> {
  const settings = await loadOcrSettings()
  if (!settings.activeModelId) {
    throw new Error('Не выбрана модель OCR')
  }

  const activeModel = settings.models.find((m) => m.id === settings.activeModelId)

  // Получаем файлы-счета заявки
  const { data: files, error: filesError } = await supabase
    .from('payment_request_files')
    .select('id, file_key, file_name, mime_type')
    .eq('payment_request_id', paymentRequestId)
    .eq('document_type_id', INVOICE_DOC_TYPE_ID)
  if (filesError) throw filesError

  const invoiceFiles = (files ?? []).filter((f: Record<string, unknown>) => {
    const mime = (f.mime_type as string) ?? ''
    return mime.startsWith('image/') || mime === 'application/pdf'
  })

  if (invoiceFiles.length === 0) return

  // Удаляем старые распознанные данные для этой заявки
  await supabase
    .from('recognized_materials')
    .delete()
    .eq('payment_request_id', paymentRequestId)

  let globalPosition = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0

  for (let fi = 0; fi < invoiceFiles.length; fi++) {
    const file = invoiceFiles[fi] as Record<string, unknown>
    const fileId = file.id as string
    const fileKey = file.file_key as string
    const mimeType = (file.mime_type as string) ?? ''

    // Создаем запись в логе
    const { data: logData, error: logInsertError } = await supabase
      .from('ocr_recognition_log')
      .insert({
        payment_request_id: paymentRequestId,
        file_id: fileId,
        model_id: settings.activeModelId,
        status: 'processing',
      })
      .select('id')
      .single()
    if (logInsertError) throw logInsertError
    const logId = (logData as Record<string, unknown>).id as string

    try {
      onProgress?.({ stage: 'downloading', fileIndex: fi, totalFiles: invoiceFiles.length })

      // Скачиваем файл из S3
      const blob = await downloadFileBlob(fileKey)
      const imagesBase64: { base64: string; pageNum: number }[] = []

      if (mimeType === 'application/pdf') {
        const arrayBuf = await blob.arrayBuffer()
        const pageCount = await getPdfPageCount(arrayBuf)
        const maxPages = Math.min(pageCount, 20) // Ограничение 20 страниц

        for (let p = 1; p <= maxPages; p++) {
          onProgress?.({
            stage: 'recognizing',
            fileIndex: fi,
            totalFiles: invoiceFiles.length,
            pageIndex: p - 1,
            totalPages: maxPages,
          })
          const pageBase64 = await renderPdfPage(arrayBuf, p)
          imagesBase64.push({ base64: pageBase64, pageNum: p })
        }
      } else {
        // Изображение
        const base64 = await blobToBase64(blob)
        imagesBase64.push({ base64, pageNum: 1 })
      }

      let fileInputTokens = 0
      let fileOutputTokens = 0

      for (const { base64, pageNum } of imagesBase64) {
        onProgress?.({
          stage: 'recognizing',
          fileIndex: fi,
          totalFiles: invoiceFiles.length,
          pageIndex: pageNum - 1,
          totalPages: imagesBase64.length,
        })

        // Первая попытка
        let result = await recognizeInvoiceStructured(base64, settings.activeModelId)
        fileInputTokens += result.inputTokens
        fileOutputTokens += result.outputTokens

        // Валидация
        const mismatched = validateAmounts(result.items)
        if (mismatched.length > 0 && result.items.length > 0) {
          onProgress?.({ stage: 'validating', fileIndex: fi, totalFiles: invoiceFiles.length })

          // Повторная попытка с подсказкой
          const hint = buildRetryHint(mismatched)
          const retryResult = await recognizeInvoiceStructured(base64, settings.activeModelId, hint)
          fileInputTokens += retryResult.inputTokens
          fileOutputTokens += retryResult.outputTokens

          // Используем повторный результат если он лучше
          const retryMismatched = validateAmounts(retryResult.items)
          if (retryMismatched.length < mismatched.length) {
            result = retryResult
          }

          // Записываем повторную попытку в лог
          await supabase.from('ocr_recognition_log').insert({
            payment_request_id: paymentRequestId,
            file_id: fileId,
            model_id: settings.activeModelId,
            status: 'success',
            attempt_number: 2,
            input_tokens: retryResult.inputTokens,
            output_tokens: retryResult.outputTokens,
            total_cost: activeModel
              ? retryResult.inputTokens * activeModel.inputPrice + retryResult.outputTokens * activeModel.outputPrice
              : null,
            completed_at: new Date().toISOString(),
          })
        }

        // Задержка между запросами
        if (imagesBase64.length > 1) {
          await new Promise((r) => setTimeout(r, API_DELAY_MS))
        }

        onProgress?.({ stage: 'saving', fileIndex: fi, totalFiles: invoiceFiles.length })

        // Сохраняем распознанные материалы
        for (const item of result.items) {
          if (!item.name) continue
          const materialId = await findOrCreateMaterial(item.name, item.unit ?? null)
          globalPosition++

          await supabase.from('recognized_materials').insert({
            payment_request_id: paymentRequestId,
            file_id: fileId,
            material_id: materialId,
            page_number: pageNum,
            position: globalPosition,
            article: item.article ?? null,
            quantity: item.quantity ?? null,
            price: item.price ?? null,
            amount: item.amount ?? null,
          })
        }
      }

      totalInputTokens += fileInputTokens
      totalOutputTokens += fileOutputTokens

      // Обновляем лог
      const totalCost = activeModel
        ? fileInputTokens * activeModel.inputPrice + fileOutputTokens * activeModel.outputPrice
        : null

      await supabase
        .from('ocr_recognition_log')
        .update({
          status: 'success',
          input_tokens: fileInputTokens,
          output_tokens: fileOutputTokens,
          total_cost: totalCost,
          completed_at: new Date().toISOString(),
        })
        .eq('id', logId)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Неизвестная ошибка OCR'
      await supabase
        .from('ocr_recognition_log')
        .update({
          status: 'error',
          error_message: errorMsg,
          completed_at: new Date().toISOString(),
        })
        .eq('id', logId)

      logError({
        errorType: 'api_error',
        errorMessage: `OCR ошибка для заявки ${paymentRequestId}: ${errorMsg}`,
        component: 'ocrService',
      })
    }
  }
}

/** Проверяет, нужно ли автоматически запустить OCR, и запускает */
export async function triggerOcrIfEnabled(paymentRequestId: string): Promise<void> {
  try {
    const settings = await loadOcrSettings()
    if (!settings.autoEnabled || !settings.activeModelId) return

    await processPaymentRequestOcr(paymentRequestId)
  } catch (err) {
    logError({
      errorType: 'api_error',
      errorMessage: `Ошибка автоматического OCR для заявки ${paymentRequestId}: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`,
      component: 'ocrService',
    })
  }
}
