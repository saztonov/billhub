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

/** Генерирует уникальный ключ для файла внутри папки контрагента */
function generateFileKey(counterpartyName: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const timestamp = Date.now()
  return `${counterpartyName}/${timestamp}_${safeName}`
}

/** Загружает файл в S3 в папку контрагента */
export async function uploadFile(
  counterpartyName: string,
  file: File,
): Promise<{ key: string }> {
  const key = generateFileKey(counterpartyName, file.name)
  const arrayBuffer = await file.arrayBuffer()

  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: new Uint8Array(arrayBuffer),
    ContentType: file.type,
  })

  await s3Client.send(command)
  return { key }
}

/** Загружает файл заявки в S3: /{контрагент}/{номер_заявки}/{timestamp}_{имя} */
export async function uploadRequestFile(
  counterpartyName: string,
  requestNumber: string,
  file: File,
): Promise<{ key: string }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const timestamp = Date.now()
  const key = `${counterpartyName}/${requestNumber}/${timestamp}_${safeName}`
  const arrayBuffer = await file.arrayBuffer()

  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: new Uint8Array(arrayBuffer),
    ContentType: file.type,
  })

  await s3Client.send(command)
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
  await s3Client.send(command)
}

/** Получает список файлов контрагента */
export async function listFiles(
  counterpartyName: string,
): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
  const command = new ListObjectsV2Command({
    Bucket: S3_BUCKET,
    Prefix: `${counterpartyName}/`,
  })

  const response = await s3Client.send(command)
  return (response.Contents ?? []).map((item) => ({
    key: item.Key ?? '',
    size: item.Size ?? 0,
    lastModified: item.LastModified ?? new Date(),
  }))
}
