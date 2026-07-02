import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { S3Client } from '@aws-sdk/client-s3';
import { parseRedisUrl } from './index.js';
import { config } from '../config.js';
import { processPaymentRequestOcr } from '../services/ocrService.js';
import type { OcrDependencies } from '../services/ocrService.js';
import { OcrProcessingRepository } from '../repositories/drizzle/ocr-processing.drizzle.js';
import type { BillhubDatabase } from '../plugins/database-drizzle.js';
import type { JobsLogRepository } from '../repositories/jobs-log.repository.js';
import { recordJobResult } from '../services/observability/jobs-log.recorder.js';
import { createObservabilityLogger } from '../services/observability/logger.js';

/** Логгер воркера OCR с redaction (Iteration 7) */
const logger = createObservabilityLogger('ocr-worker');

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
function createWorkerDeps(db: BillhubDatabase): OcrDependencies {
  const ocrRepo = new OcrProcessingRepository(db);

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

  const region = config.storageProvider === 'cloudflare' ? 'auto' : config.s3Region;

  const s3Client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  return { ocrRepo, s3Client, s3Bucket: bucket };
}

/* ------------------------------------------------------------------ */
/*  Обработчик задачи                                                  */
/* ------------------------------------------------------------------ */

async function processOcrJob(job: Job<OcrJobData>, db: BillhubDatabase | undefined): Promise<void> {
  const { paymentRequestId, userId } = job.data;
  logger.info({ jobId: job.id, paymentRequestId, userId }, 'Начало OCR обработки');

  if (!db) {
    throw new Error('ocr-worker: Drizzle db не инициализирован — OCR недоступен');
  }
  const deps = createWorkerDeps(db);

  await processPaymentRequestOcr(deps, paymentRequestId, async (progress) => {
    // Прогресс: процент на основе этапов
    const filePercent =
      progress.totalFiles > 0 ? (progress.fileIndex / progress.totalFiles) * 100 : 0;

    const pagePercent =
      progress.totalPages && progress.totalPages > 0 && progress.pageIndex != null
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

/** Зависимости воркера OCR: отчётность в jobs_log + Drizzle-клиент для данных OCR. */
export interface OcrWorkerDeps {
  jobsLog?: JobsLogRepository;
  /** Drizzle-клиент (обязателен для распознавания на Yandex PG). */
  db?: BillhubDatabase;
}

/** Длительность выполнения задачи (мс) по таймштампам BullMQ, либо null. */
function jobDurationMs(job: Job | undefined): number | null {
  if (job?.processedOn && job?.finishedOn) return job.finishedOn - job.processedOn;
  return null;
}

/** Создание воркера OCR */
export function createOcrWorker(deps: OcrWorkerDeps = {}): Worker<OcrJobData> {
  const connection = parseRedisUrl(config.redisUrl);

  const worker = new Worker<OcrJobData>('ocr-processing', (job) => processOcrJob(job, deps.db), {
    connection,
    // OCR_CONCURRENCY (Iteration 8). По умолчанию 1; в worker-контейнере на 4GB VPS — 3.
    concurrency: config.ocrConcurrency,
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'OCR задача завершена');
    if (deps.jobsLog) {
      void recordJobResult(
        deps.jobsLog,
        {
          queueName: 'ocr-processing',
          jobId: String(job.id ?? ''),
          type: job.name,
          attemptsMade: job.attemptsMade,
          maxAttempts: job.opts.attempts ?? 1,
          durationMs: jobDurationMs(job),
          completed: true,
        },
        (err) => logger.error({ err }, 'jobs_log запись (completed) не удалась'),
      );
    }
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'OCR задача завершилась с ошибкой');
    if (deps.jobsLog && job) {
      void recordJobResult(
        deps.jobsLog,
        {
          queueName: 'ocr-processing',
          jobId: String(job.id ?? ''),
          type: job.name,
          attemptsMade: job.attemptsMade,
          maxAttempts: job.opts.attempts ?? 1,
          durationMs: jobDurationMs(job),
          error: err.message,
          completed: false,
        },
        (e) => logger.error({ err: e }, 'jobs_log запись (failed) не удалась'),
      );
    }
  });

  worker.on('error', (err) => {
    logger.error({ err: err.message }, 'Ошибка OCR воркера');
  });

  return worker;
}
