import { api } from '@/services/api'

// Типы ответов API
interface UploadUrlResponse {
  uploadUrl: string
  fileKey: string
}

interface DownloadUrlResponse {
  downloadUrl: string
}

/** Загружает файл напрямую в S3 по presigned URL */
async function putToS3(uploadUrl: string, file: File): Promise<void> {
  const contentType = file.type || 'application/octet-stream'
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': contentType },
  })
  if (!res.ok) throw new Error(`Ошибка загрузки файла: ${res.status}`)
}

/** Загружает файл в папку контрагента */
export async function uploadFile(
  counterpartyName: string,
  file: File,
): Promise<{ key: string }> {
  const { uploadUrl, fileKey } = await api.post<UploadUrlResponse>('/api/files/upload-url', {
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    context: 'general',
    counterpartyName,
  })
  await putToS3(uploadUrl, file)
  return { key: fileKey }
}

/** Загружает файл заявки */
export async function uploadRequestFile(
  counterpartyName: string,
  requestNumber: string,
  file: File,
): Promise<{ key: string }> {
  const { uploadUrl, fileKey } = await api.post<UploadUrlResponse>('/api/files/upload-url', {
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    context: 'request',
    counterpartyName,
    requestNumber,
  })
  await putToS3(uploadUrl, file)
  return { key: fileKey }
}

/** Загружает файл решения об отклонении */
export async function uploadDecisionFile(
  decisionId: string,
  file: File,
): Promise<{ key: string }> {
  const { uploadUrl, fileKey } = await api.post<UploadUrlResponse>('/api/files/upload-url', {
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    context: 'decision',
    entityId: decisionId,
  })
  await putToS3(uploadUrl, file)
  return { key: fileKey }
}

/** Загружает файл оплаты */
export async function uploadPaymentFile(
  counterpartyName: string,
  paymentId: string,
  file: File,
): Promise<{ key: string }> {
  const { uploadUrl, fileKey } = await api.post<UploadUrlResponse>('/api/files/upload-url', {
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    context: 'payment',
    counterpartyName,
    entityId: paymentId,
  })
  await putToS3(uploadUrl, file)
  return { key: fileKey }
}

/** Получает presigned URL для скачивания файла */
export async function getDownloadUrl(
  key: string,
  _expiresIn?: number,
  fileName?: string,
): Promise<string> {
  const params: Record<string, string> = {}
  if (fileName) params.fileName = fileName
  const { downloadUrl } = await api.get<DownloadUrlResponse>(
    `/api/files/download-url/${encodeURIComponent(key)}`,
    params,
  )
  return downloadUrl
}

/** Скачивает файл как Blob */
export async function downloadFileBlob(key: string): Promise<Blob> {
  const url = await getDownloadUrl(key)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Ошибка скачивания файла: ${res.status}`)
  return res.blob()
}

/** Получает presigned URL для загрузки (совместимость) */
export async function getUploadUrl(
  key: string,
  contentType: string,
): Promise<string> {
  const { uploadUrl } = await api.post<UploadUrlResponse>('/api/files/upload-url', {
    fileName: key.split('/').pop() || 'file',
    contentType,
    context: 'general',
  })
  return uploadUrl
}

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
