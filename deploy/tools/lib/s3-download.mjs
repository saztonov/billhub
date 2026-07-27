/**
 * s3-download — скачивание объектов Cloud.ru S3 для разовых выгрузок (deploy/tools/export-*.mjs).
 *
 * Зависит от @aws-sdk/client-s3, поэтому запускается только там, где он установлен, — внутри
 * образа billhub-api. Чистые утилиты (имена, CSV) вынесены в export-common.mjs без зависимостей.
 *
 * ТОЛЬКО ЧТЕНИЕ: GetObject. Ничего не изменяет.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

/** Число попыток скачивания одного объекта. */
const MAX_ATTEMPTS = 3;

/**
 * Клиент и бакет по той же логике, что в server/src/plugins/s3.ts: при
 * STORAGE_PROVIDER=cloudflare рабочее хранилище — R2 (регион «auto»), иначе Cloud.ru S3.
 * Брать всегда S3_* нельзя: в проде обе группы переменных заданы, но файлы лежат в одной из них.
 */
export function resolveStorage(env = process.env) {
  const provider = env.STORAGE_PROVIDER === 'cloudflare' ? 'cloudflare' : 'cloudru';
  const cloudflare = provider === 'cloudflare';

  const endpoint = cloudflare ? env.R2_ENDPOINT : env.S3_ENDPOINT;
  const bucket = cloudflare ? env.R2_BUCKET : env.S3_BUCKET;
  const accessKeyId = cloudflare ? env.R2_ACCESS_KEY : env.S3_ACCESS_KEY;
  const secretAccessKey = cloudflare ? env.R2_SECRET_KEY : env.S3_SECRET_KEY;
  const prefix = cloudflare ? 'R2' : 'S3';
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      `Провайдер хранилища «${provider}»: не заданы ${prefix}_ENDPOINT / ${prefix}_BUCKET / ` +
        `${prefix}_ACCESS_KEY / ${prefix}_SECRET_KEY`,
    );
  }

  const client = new S3Client({
    endpoint,
    region: cloudflare ? 'auto' : env.S3_REGION || 'ru-1',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    maxAttempts: 5,
  });
  return { client, bucket, provider };
}

/**
 * Скачивает один объект S3 во временный .part и переименовывает после успеха.
 * Путь внутри выгрузки берётся из item.relativePath (posix-разделители).
 */
export async function downloadOne(s3, bucket, item, outDir) {
  const targetPath = path.join(outDir, item.relativePath);
  const tempPath = `${targetPath}.part`;

  // Повторный запуск не перекачивает уже готовые файлы совпадающего размера
  if (item.file_size) {
    try {
      const existing = await stat(targetPath);
      if (existing.size === Number(item.file_size)) return { skipped: true, size: existing.size };
    } catch {
      // файла нет — качаем
    }
  }

  await mkdir(path.dirname(targetPath), { recursive: true });

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: item.file_key }));
      if (!response.Body) throw new Error('S3 вернул пустой Body');
      await pipeline(response.Body, createWriteStream(tempPath));
      const written = await stat(tempPath);
      await rename(tempPath, targetPath);
      return { skipped: false, size: written.size };
    } catch (error) {
      lastError = error;
      await unlink(tempPath).catch(() => {});
      const notFound = error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;
      if (notFound || attempt === MAX_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError ?? new Error('Неизвестная ошибка скачивания');
}

/**
 * Пул воркеров с ограниченным параллелизмом; ошибки складываются в errors, прогон не прерывается.
 * failed нужен вызывающему, чтобы не класть в архив то, что не скачалось.
 */
export async function downloadAll(s3, bucket, items, outDir, concurrency, onProgress) {
  const errors = [];
  const failed = new Set();
  let downloaded = 0;
  let skipped = 0;
  let bytes = 0;
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      try {
        const result = await downloadOne(s3, bucket, item, outDir);
        bytes += result.size;
        if (result.skipped) skipped += 1;
        else downloaded += 1;
      } catch (error) {
        failed.add(item.relativePath);
        errors.push({ item, message: error?.message ?? String(error) });
      }
      onProgress(downloaded + skipped + errors.length, items.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { downloaded, skipped, bytes, errors, failed };
}
