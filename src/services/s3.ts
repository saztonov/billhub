import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Конфигурация S3 из переменных окружения
const S3_ENDPOINT = import.meta.env.VITE_S3_ENDPOINT as string
const S3_REGION = (import.meta.env.VITE_S3_REGION as string) || 'ru-msk'
const S3_ACCESS_KEY = import.meta.env.VITE_S3_ACCESS_KEY as string
const S3_SECRET_KEY = import.meta.env.VITE_S3_SECRET_KEY as string
const S3_BUCKET_INVOICES = (import.meta.env.VITE_S3_BUCKET_INVOICES as string) || 'invoices'
const S3_BUCKET_DOCUMENTS = (import.meta.env.VITE_S3_BUCKET_DOCUMENTS as string) || 'documents'

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

/** Доступные бакеты */
export const S3_BUCKETS = {
  invoices: S3_BUCKET_INVOICES,
  documents: S3_BUCKET_DOCUMENTS,
} as const

type BucketName = keyof typeof S3_BUCKETS

/** Генерирует уникальный ключ для файла */
function generateFileKey(folder: string, fileName: string): string {
  const timestamp = Date.now()
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${folder}/${timestamp}_${safeName}`
}

/** Загружает файл в S3 */
export async function uploadFile(
  bucket: BucketName,
  folder: string,
  file: File,
): Promise<{ key: string; url: string }> {
  const key = generateFileKey(folder, file.name)
  const arrayBuffer = await file.arrayBuffer()

  const command = new PutObjectCommand({
    Bucket: S3_BUCKETS[bucket],
    Key: key,
    Body: new Uint8Array(arrayBuffer),
    ContentType: file.type,
  })

  await s3Client.send(command)

  // Возвращаем ключ и presigned URL для доступа
  const url = await getDownloadUrl(bucket, key)
  return { key, url }
}

/** Получает presigned URL для скачивания файла (время жизни 1 час) */
export async function getDownloadUrl(
  bucket: BucketName,
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKETS[bucket],
    Key: key,
  })
  return getSignedUrl(s3Client, command, { expiresIn })
}

/** Получает presigned URL для загрузки файла напрямую из браузера */
export async function getUploadUrl(
  bucket: BucketName,
  key: string,
  contentType: string,
  expiresIn = 3600,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKETS[bucket],
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(s3Client, command, { expiresIn })
}

/** Удаляет файл из S3 */
export async function deleteFile(
  bucket: BucketName,
  key: string,
): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: S3_BUCKETS[bucket],
    Key: key,
  })
  await s3Client.send(command)
}

/** Получает список файлов в папке */
export async function listFiles(
  bucket: BucketName,
  prefix: string,
): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
  const command = new ListObjectsV2Command({
    Bucket: S3_BUCKETS[bucket],
    Prefix: prefix,
  })

  const response = await s3Client.send(command)
  return (response.Contents ?? []).map((item) => ({
    key: item.Key ?? '',
    size: item.Size ?? 0,
    lastModified: item.LastModified ?? new Date(),
  }))
}

/** Загружает счёт в S3 и возвращает ключ */
export async function uploadInvoiceFile(
  counterpartyId: string,
  file: File,
): Promise<{ key: string; url: string }> {
  return uploadFile('invoices', counterpartyId, file)
}

/** Загружает документ в S3 и возвращает ключ */
export async function uploadDocumentFile(
  counterpartyId: string,
  file: File,
): Promise<{ key: string; url: string }> {
  return uploadFile('documents', counterpartyId, file)
}
