import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { createClient } from '@supabase/supabase-js';
import { S3Client } from '@aws-sdk/client-s3';
import pino from 'pino';
import { parseRedisUrl } from './index.js';
import { config } from '../config.js';
import { processPaymentRequestOcr } from '../services/ocrService.js';
import type { OcrDependencies } from '../services/ocrService.js';

/** Логгер воркера OCR */
const logger = pino({ name: 'ocr-worker' });

/* ------------------------------------------------------------------ */
/*  Типы                                                               */
/* ------------------------------------------------------------------ */

/** Данные задачи OCR */
export interface OcrJobData {
  paymentRequestId: string;
  userId: string;
}

/* ------------------------------------------------------------------ */
/*  Зависимости воркера (создаются один раз)                           */
/* ------------------------------------------------------------------ */

/** Создает зависимости для OCR-сервиса (отдельный экземпляр для воркера) */
function createWorkerDeps(): OcrDependencies {
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

  let endpoint: string;
  let accessKeyId: string;
  let secretAccessKey: string;
  let bucket: string;

  if (config.storageProvider === 'cloudflare') {
    endpoint = config.r2Endpoint;
    accessKeyId = config.r2AccessKey;
    secretAccessKey = config.r2SecretKey;
    bucket = config.r2Bucket;
  } else {
    endpoint = config.s3Endpoint;
    accessKeyId = config.s3AccessKey;
    secretAccessKey = config.s3SecretKey;
    bucket = config.s3Bucket;
  }

  const s3Client = new S3Client({
    endpoint,
    region: config.s3Region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  return { supabase, s3Client, s3Bucket: bucket };
}

/* ------------------------------------------------------------------ */
/*  Обработчик задачи                                                  */
/* ------------------------------------------------------------------ */

async function processOcrJob(job: Job<OcrJobData>): Promise<void> {
  const { paymentRequestId, userId } = job.data;
  logger.info({ jobId: job.id, paymentRequestId, userId }, 'Начало OCR обработки');

  const deps = createWorkerDeps();

  await processPaymentRequestOcr(deps, paymentRequestId, async (progress) => {
    // Прогресс: процент на основе этапов
    const filePercent = progress.totalFiles > 0
      ? (progress.fileIndex / progress.totalFiles) * 100
      : 0;

    const pagePercent = progress.totalPages && progress.totalPages > 0 && progress.pageIndex != null
      ? ((progress.pageIndex + 1) / progress.totalPages) * (100 / (progress.totalFiles || 1))
      : 0;

    const totalPercent = Math.min(Math.round(filePercent + pagePercent), 99);

    await job.updateProgress({
      percent: totalPercent,
      stage: progress.stage,
      fileIndex: progress.fileIndex,
      totalFiles: progress.totalFiles,
      pageIndex: progress.pageIndex,
      totalPages: progress.totalPages,
    });
  });

  await job.updateProgress({ percent: 100, stage: 'done' });
  logger.info({ jobId: job.id, paymentRequestId }, 'OCR обработка завершена');
}

/* ------------------------------------------------------------------ */
/*  Создание воркера                                                   */
/* ------------------------------------------------------------------ */

/** Создание воркера OCR */
export function createOcrWorker(): Worker<OcrJobData> {
  const connection = parseRedisUrl(config.redisUrl);

  const worker = new Worker<OcrJobData>(
    'ocr-processing',
    processOcrJob,
    {
      connection,
      concurrency: 1, // Один OCR за раз (экономия памяти на 2GB VPS)
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'OCR задача завершена');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err: err.message },
      'OCR задача завершилась с ошибкой',
    );
  });

  worker.on('error', (err) => {
    logger.error({ err: err.message }, 'Ошибка OCR воркера');
  });

  return worker;
}
