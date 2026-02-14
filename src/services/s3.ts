import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { sanitizeForS3 } from '@/utils/transliterate'

// Конфигурация S3 из переменных окружения
const S3_ENDPOINT = import.meta.env.VITE_S3_ENDPOINT as string
const S3_REGION = (import.meta.env.VITE_S3_REGION as string) || 'ru-msk'
const S3_ACCESS_KEY = import.meta.env.VITE_S3_ACCESS_KEY as string
const S3_SECRET_KEY = import.meta.env.VITE_S3_SECRET_KEY as string
const S3_BUCKET = import.meta.env.VITE_S3_BUCKET as string

/** Клиент S3 для Cloud.ru (S3-совместимый API) */
const s3Client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
  forcePathStyle: true,
})

// Базовый endpoint без trailing slash для корректной подмены в presigned URL
const S3_BASE = S3_ENDPOINT.replace(/\/$/, '')

/** Загрузка файла через presigned URL + fetch (обход CORS в dev через Vite proxy) */
async function uploadToS3(key: string, file: File): Promise<void> {
  const contentType = file.type || 'application/octet-stream'
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ContentType: contentType,
  })

  // Presigned URL генерируется локально, без HTTP-запроса
  let url = await getSignedUrl(s3Client, command, { expiresIn: 300 })

  // В dev-режиме подменяем endpoint на Vite proxy
  if (import.meta.env.DEV) {
    url = url.replace(S3_BASE, '/s3-proxy')
  }

  const res = await fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': contentType },
  })

  if (!res.ok) {
    throw new Error(`Ошибка загрузки файла: ${res.status} ${res.statusText}`)
  }
}

/** Генерирует уникальный ключ для файла внутри папки контрагента */
function generateFileKey(counterpartyName: string, fileName: string): string {
  const safeFolder = sanitizeForS3(counterpartyName)
  const safeName = sanitizeForS3(fileName)
  const timestamp = Date.now()
  return `${safeFolder}/${timestamp}_${safeName}`
}

/** Загружает файл в S3 в папку контрагента */
export async function uploadFile(
  counterpartyName: string,
  file: File,
): Promise<{ key: string }> {
  const key = generateFileKey(counterpartyName, file.name)
  await uploadToS3(key, file)
  return { key }
}

/** Загружает файл заявки в S3: /{контрагент}/{номер_заявки}/{timestamp}_{имя} */
export async function uploadRequestFile(
  counterpartyName: string,
  requestNumber: string,
  file: File,
): Promise<{ key: string }> {
  const safeFolder = sanitizeForS3(counterpartyName)
  const safeNumber = sanitizeForS3(requestNumber)
  const safeName = sanitizeForS3(file.name)
  const timestamp = Date.now()
  const key = `${safeFolder}/${safeNumber}/${timestamp}_${safeName}`
  await uploadToS3(key, file)
  return { key }
}

/** Загружает файл решения об отклонении в S3: /approval-decisions/{decision_id}/{timestamp}_{имя} */
export async function uploadDecisionFile(
  decisionId: string,
  file: File,
): Promise<{ key: string }> {
  const safeName = sanitizeForS3(file.name)
  const timestamp = Date.now()
  const key = `approval-decisions/${decisionId}/${timestamp}_${safeName}`
  await uploadToS3(key, file)
  return { key }
}

/** Получает presigned URL для скачивания файла (время жизни 1 час) */
export async function getDownloadUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  })
  return getSignedUrl(s3Client, command, { expiresIn })
}

/** Скачивает файл как Blob (через Vite proxy в dev для обхода CORS) */
export async function downloadFileBlob(key: string): Promise<Blob> {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  })
  let url = await getSignedUrl(s3Client, command, { expiresIn: 3600 })
  if (import.meta.env.DEV) {
    url = url.replace(S3_BASE, '/s3-proxy')
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Ошибка скачивания файла: ${res.status}`)
  }
  return res.blob()
}

/** Получает presigned URL для загрузки файла напрямую из браузера */
export async function getUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(s3Client, command, { expiresIn })
}

/** Удаляет файл из S3 */
export async function deleteFile(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  })

  let url = await getSignedUrl(s3Client, command, { expiresIn: 300 })

  if (import.meta.env.DEV) {
    url = url.replace(S3_BASE, '/s3-proxy')
  }

  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) {
    throw new Error(`Ошибка удаления файла: ${res.status}`)
  }
}

/** Получает список файлов контрагента */
export async function listFiles(
  counterpartyName: string,
): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
  const safeFolder = sanitizeForS3(counterpartyName)
  const command = new ListObjectsV2Command({
    Bucket: S3_BUCKET,
    Prefix: `${safeFolder}/`,
  })

  const response = await s3Client.send(command)
  return (response.Contents ?? []).map((item) => ({
    key: item.Key ?? '',
    size: item.Size ?? 0,
    lastModified: item.LastModified ?? new Date(),
  }))
}
