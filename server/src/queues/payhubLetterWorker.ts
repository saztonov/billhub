/**
 * Воркер синхронизации писем РП с PayHub (очередь payhub-letter-sync, 0008).
 *
 * Задачи:
 *   - 'sync'  — синхронизация одного письма (бизнес-логика в services/rp/rp-letter-sync);
 *   - 'sweep' — периодическая страховка: переставляет в очередь РП в статусах
 *     pending (потеря Redis) и waiting_config (админ мог заполнить настройку).
 *     Статус uploading sweep НЕ трогает — файлы ещё догружает клиент.
 *
 * Ретраи: exponential backoff из defaultJobOptions очереди; waiting_config попытки
 * не расходует (задача завершается успешно). После исчерпания попыток статус failed
 * ставится в обработчике 'failed' (ручной повтор кнопкой в реестре).
 */
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config.js';
import { parseRedisUrl, payhubLetterQueue, enqueueRpLetterSync } from './index.js';
import type { PayhubLetterJobData } from './index.js';
import type { BillhubDatabase } from '../plugins/database-drizzle.js';
import type { JobsLogRepository } from '../repositories/jobs-log.repository.js';
import { recordJobResult } from '../services/observability/jobs-log.recorder.js';
import { createObservabilityLogger } from '../services/observability/logger.js';
import { DrizzleRpRepository } from '../repositories/drizzle/rp.drizzle.js';
import { createPayHubClientFromEnv } from '../services/payhub/payhub-client.js';
import { getRpSenderSetting } from '../services/rp/rp-sender-setting.js';
import { syncRpLetter } from '../services/rp/rp-letter-sync.js';

const logger = createObservabilityLogger('payhub-letter-worker');

/** Параллелизм небольшой: писем немного, вложения буферизуются в память по одному */
const CONCURRENCY = 2;

/** Интервал sweep-задачи (мс) */
export const RP_LETTER_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/** S3-клиент billhub-хранилища (паттерн ocrWorker: воркер живёт вне Fastify) */
function createS3(): { client: S3Client; bucket: string } {
  const isR2 = config.storageProvider === 'cloudflare';
  const client = new S3Client({
    endpoint: isR2 ? config.r2Endpoint : config.s3Endpoint,
    region: isR2 ? 'auto' : config.s3Region,
    credentials: {
      accessKeyId: isR2 ? config.r2AccessKey : config.s3AccessKey,
      secretAccessKey: isR2 ? config.r2SecretKey : config.s3SecretKey,
    },
    forcePathStyle: true,
  });
  return { client, bucket: isR2 ? config.r2Bucket : config.s3Bucket };
}

/** Скачивание файла вложения из billhub S3 в память (лимит размеров — на загрузке) */
async function downloadFromS3(fileKey: string): Promise<Buffer> {
  const { client, bucket } = createS3();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: fileKey }));
    if (!result.Body) throw new Error(`S3: пустое тело объекта ${fileKey}`);
    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  } finally {
    client.destroy();
  }
}

/** Обработка sweep: переставить в очередь кандидатов (дедуп — по jobId).
 * failed включён, чтобы письма, исчерпавшие ретраи на временно недоступном PayHub
 * или до деплоя поддержки external_ref, автоматически пересинхронизировались. */
async function processSweep(db: BillhubDatabase): Promise<void> {
  const repo = new DrizzleRpRepository(db);
  const ids = await repo.listLetterSyncCandidates(['pending', 'waiting_config', 'failed']);
  for (const id of ids) {
    await enqueueRpLetterSync(id);
  }
  if (ids.length > 0) {
    logger.info({ count: ids.length }, 'RP-письма: sweep переставил задачи в очередь');
  }
}

/** Обработка sync одной РП */
async function processSync(job: Job<PayhubLetterJobData>, db: BillhubDatabase): Promise<void> {
  const rpLetterId = job.data.rpLetterId;
  if (!rpLetterId) throw new Error('payhub-letter-sync: rpLetterId отсутствует в данных задачи');

  const repo = new DrizzleRpRepository(db);
  try {
    const outcome = await syncRpLetter(
      {
        repo,
        payhub: createPayHubClientFromEnv(),
        getSender: () => getRpSenderSetting(db),
        downloadFile: downloadFromS3,
        log: logger,
      },
      rpLetterId,
    );
    logger.info({ jobId: job.id, rpLetterId, outcome }, 'RP-письмо: задача завершена');
  } catch (error) {
    // Временная ошибка: фиксируем текст для UI; статус остаётся pending до исчерпания
    // попыток (failed ставится в обработчике 'failed' воркера).
    const message = error instanceof Error ? error.message : String(error);
    await repo.setLetterSyncStatus(rpLetterId, 'pending', message).catch(() => {});
    throw error;
  }
}

export interface PayhubLetterWorkerDeps {
  jobsLog?: JobsLogRepository;
  db?: BillhubDatabase;
}

/** Длительность выполнения задачи (мс) по таймштампам BullMQ, либо null. */
function jobDurationMs(job: Job | undefined): number | null {
  if (job?.processedOn && job?.finishedOn) return job.finishedOn - job.processedOn;
  return null;
}

/** Создание и запуск воркера; также регистрирует периодическую sweep-задачу. */
export function createPayhubLetterWorker(
  deps: PayhubLetterWorkerDeps = {},
): Worker<PayhubLetterJobData> {
  const connection = parseRedisUrl(config.redisUrl);

  const worker = new Worker<PayhubLetterJobData>(
    'payhub-letter-sync',
    async (job) => {
      const db = deps.db;
      if (!db) {
        throw new Error('payhub-letter-sync: Drizzle db не инициализирован');
      }
      if (job.name === 'sweep') {
        await processSweep(db);
        return;
      }
      await processSync(job, db);
    },
    { connection, concurrency: CONCURRENCY },
  );

  // Периодический sweep (upsert идемпотентен; sweep-задачи не ретраятся).
  void payhubLetterQueue
    .upsertJobScheduler(
      'rp-letter-sweep',
      { every: RP_LETTER_SWEEP_INTERVAL_MS },
      { name: 'sweep', opts: { attempts: 1 } },
    )
    .catch((err: unknown) => logger.error({ err }, 'RP-письма: не удалось зарегистрировать sweep'));

  worker.on('completed', (job) => {
    if (deps.jobsLog) {
      void recordJobResult(
        deps.jobsLog,
        {
          queueName: 'payhub-letter-sync',
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
    logger.error(
      { jobId: job?.id, err: err.message },
      'RP-письмо: попытка синхронизации не удалась',
    );
    // Исчерпаны попытки sync-задачи — фиксируем failed для UI (кнопка «Повторить»).
    const rpLetterId = job?.data?.rpLetterId;
    if (job && job.name === 'sync' && rpLetterId && deps.db) {
      const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
      if (exhausted) {
        const repo = new DrizzleRpRepository(deps.db);
        void repo
          .setLetterSyncStatus(rpLetterId, 'failed', err.message)
          .catch((e: unknown) => logger.error({ err: e }, 'RP-письмо: не удалось записать failed'));
      }
    }
    if (deps.jobsLog && job) {
      void recordJobResult(
        deps.jobsLog,
        {
          queueName: 'payhub-letter-sync',
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
    logger.error({ err: err.message }, 'Ошибка воркера payhub-letter-sync');
  });

  return worker;
}
