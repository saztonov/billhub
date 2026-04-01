import { api } from '@/services/api'

/* ------------------------------------------------------------------ */
/*  Константы                                                          */
/* ------------------------------------------------------------------ */

/** Размер чанка (5 МБ — совпадает с серверным PART_SIZE) */
const CHUNK_SIZE = 5 * 1024 * 1024

/** Максимальное время клиентских ретраев (20 минут) */
const MAX_RETRY_DURATION_MS = 20 * 60 * 1000

/** Максимальная задержка между ретраями (2 минуты) */
const MAX_RETRY_DELAY_MS = 2 * 60 * 1000

/** Начальная задержка ретрая (5 секунд) */
const INITIAL_RETRY_DELAY_MS = 5000

/* ------------------------------------------------------------------ */
/*  Типы                                                               */
/* ------------------------------------------------------------------ */

interface InitResponse {
  uploadId: string
  fileKey: string
  partSize: number
  totalParts: number
}

interface PartResponse {
  partNumber: number
  etag: string
}

interface CompleteResponse {
  fileKey: string
  fileSize: number
  mimeType: string
}

interface StatusResponse {
  uploadId: string
  fileKey: string
  uploadedParts: number[]
  totalParts: number
}

/* ------------------------------------------------------------------ */
/*  Утилита ретраев с экспоненциальным backoff                         */
/* ------------------------------------------------------------------ */

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Выполняет функцию с автоматическими ретраями (экспоненциальный backoff).
 * Ретраит ошибки 502, 503, 0 (сеть) в течение MAX_RETRY_DURATION_MS.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const startTime = Date.now()
  let delay = INITIAL_RETRY_DELAY_MS

  while (true) {
    try {
      return await fn()
    } catch (err: unknown) {
      const elapsed = Date.now() - startTime
      const status = (err as { status?: number }).status ?? 0
      const isRetryable = status === 0 || status === 502 || status === 503

      if (!isRetryable || elapsed + delay > MAX_RETRY_DURATION_MS) {
        throw err
      }

      await sleep(delay)
      delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Чанковая загрузка через серверный proxy                            */
/* ------------------------------------------------------------------ */

/** Контексты загрузки (совпадают с серверными) */
type UploadContext = 'request' | 'decision' | 'payment' | 'contract' | 'general' | 'founding'

interface UploadOptions {
  context: UploadContext
  counterpartyName?: string
  requestNumber?: string
  entityId?: string
}

/**
 * Загружает файл чанками через серверный proxy.
 * Каждый чанк — отдельный HTTP-запрос, при разрыве связи теряется только текущий чанк.
 */
async function chunkedUpload(file: File, options: UploadOptions): Promise<{ key: string }> {
  const contentType = file.type || 'application/octet-stream'

  /** 1. Инициализация сессии загрузки */
  const initData = await api.post<InitResponse>('/api/files/upload/init', {
    fileName: file.name,
    contentType,
    fileSize: file.size,
    ...options,
  })

  const { uploadId, fileKey, totalParts } = initData

  /** 2. Определяем какие чанки уже загружены (для resume) */
  let uploadedSet = new Set<number>()

  /** 3. Загрузка чанков последовательно */
  for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
    if (uploadedSet.has(partNumber)) continue

    const start = (partNumber - 1) * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const chunk = file.slice(start, end)

    await withRetry(async () => {
      await api.putBinary<PartResponse>(
        `/api/files/upload/${uploadId}/part/${partNumber}`,
        chunk,
      )
    })
  }

  /** 4. Завершение загрузки */
  await api.post<CompleteResponse>(`/api/files/upload/${uploadId}/complete`)

  return { key: fileKey }
}

/**
 * Пытается восстановить загрузку после полного обрыва (например, F5 в браузере).
 * Возвращает список загруженных частей или null, если сессия не найдена.
 */
export async function getUploadStatus(uploadId: string): Promise<StatusResponse | null> {
  try {
    return await api.get<StatusResponse>(`/api/files/upload/${uploadId}/status`)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/*  Публичные функции загрузки (API совместим со старым)                */
/* ------------------------------------------------------------------ */

/** Загружает файл в папку контрагента */
export async function uploadFile(
  counterpartyName: string,
  file: File,
): Promise<{ key: string }> {
  return chunkedUpload(file, { context: 'general', counterpartyName })
}

/** Загружает файл заявки */
export async function uploadRequestFile(
  counterpartyName: string,
  requestNumber: string,
  file: File,
): Promise<{ key: string }> {
  return chunkedUpload(file, { context: 'request', counterpartyName, requestNumber })
}

/** Загружает файл решения об отклонении */
export async function uploadDecisionFile(
  decisionId: string,
  file: File,
): Promise<{ key: string }> {
  return chunkedUpload(file, { context: 'decision', entityId: decisionId })
}

/** Загружает файл учредительного документа */
export async function uploadFoundingFile(
  entityId: string,
  file: File,
): Promise<{ key: string }> {
  return chunkedUpload(file, { context: 'founding', entityId })
}

/** Загружает файл оплаты */
export async function uploadPaymentFile(
  counterpartyName: string,
  paymentId: string,
  file: File,
): Promise<{ key: string }> {
  return chunkedUpload(file, { context: 'payment', counterpartyName, entityId: paymentId })
}

/* ------------------------------------------------------------------ */
/*  Скачивание через серверный proxy                                   */
/* ------------------------------------------------------------------ */

/** Возвращает URL для скачивания файла через proxy */
export function getProxyDownloadUrl(key: string, fileName?: string): string {
  const base = (import.meta.env.VITE_API_URL || '') + `/api/files/download/${encodeURIComponent(key)}`
  if (fileName) return `${base}?fileName=${encodeURIComponent(fileName)}`
  return base
}

/** Получает URL для скачивания файла (через серверный proxy) */
export async function getDownloadUrl(
  key: string,
  _expiresIn?: number,
  fileName?: string,
): Promise<string> {
  return getProxyDownloadUrl(key, fileName)
}

/** Скачивает файл как Blob через серверный proxy */
export async function downloadFileBlob(key: string): Promise<Blob> {
  const url = getProxyDownloadUrl(key)
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`Ошибка скачивания файла: ${res.status}`)
  return res.blob()
}

/* ------------------------------------------------------------------ */
/*  Прочие функции (без изменений)                                     */
/* ------------------------------------------------------------------ */

/** Удаляет файл */
export async function deleteFile(key: string): Promise<void> {
  await api.delete(`/api/files/${encodeURIComponent(key)}`)
}

/** Проверяет подключение к S3 хранилищу (админ) */
export async function testS3Connection(): Promise<{ ok: true; provider: string }> {
  return api.get('/api/files/test-connection')
}

/** Получает список файлов контрагента */
export async function listFiles(
  counterpartyName: string,
): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
  const data = await api.get<{ files: Array<{ key: string; size: number; lastModified: string }> }>(
    `/api/files/list/${encodeURIComponent(counterpartyName)}`,
  )
  return data.files.map((f) => ({ ...f, lastModified: new Date(f.lastModified) }))
}
