/**
 * Воркер выгрузки счетов заявок на оплату в SIGNAL DOCS (очередь sgnl-sync, 0023).
 *
 * Задача 'run' — один прогон выгрузки (бизнес-логика в services/sgnl/sgnl-sync):
 *   - по расписанию SGNL_SYNC_CRON (если задано), например ежедневно в 04:00;
 *   - вручную из админки (кнопка «Выгрузить сейчас», в т.ч. по одному объекту).
 * Concurrency 1: прогоны не пересекаются. Первичная выгрузка — первый прогон с пустым журналом.
 * Итог прогона пишется в settings (вкладка «SIGNAL») и в jobs_log.
 */
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config.js';
import { parseRedisUrl, sgnlSyncQueue } from './index.js';
import type { SgnlSyncJobData } from './index.js';
import type { BillhubDatabase } from '../plugins/database-drizzle.js';
import type { JobsLogRepository } from '../repositories/jobs-log.repository.js';
import { recordJobResult } from '../services/observability/jobs-log.recorder.js';
import { createObservabilityLogger } from '../services/observability/logger.js';
import { DrizzleSgnlExportRepository } from '../repositories/drizzle/sgnl-export.drizzle.js';
import { createSgnlClientFromEnv } from '../services/sgnl/sgnl-client.js';
import { runSgnlSync } from '../services/sgnl/sgnl-sync.js';
import { setSgnlLastRun } from '../services/sgnl/sgnl-last-run.js';

const logger = createObservabilityLogger('sgnl-sync-worker');

/** Id расписания ежедневной выгрузки */
const SCHEDULER_ID = 'sgnl-daily';
const QUEUE_NAME = 'sgnl-sync';

/** S3-клиент billhub-хранилища (паттерн payhubLetterWorker: воркер живёт вне Fastify) */
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

/** Загрузчик файлов из S3 на время прогона (один клиент на прогон) */
function createDownloader(): { download: (fileKey: string) => Promise<Buffer>; close: () => void } {
  const { client, bucket } = createS3();
  return {
    download: async (fileKey) => {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: fileKey }));
      if (!result.Body) throw new Error(`S3: пустое тело объекта ${fileKey}`);
      return Buffer.from(await result.Body.transformToByteArray());
    },
    close: () => client.destroy(),
  };
}

async function processRun(job: Job<SgnlSyncJobData>, db: BillhubDatabase): Promise<void> {
  if (!config.sgnlSyncEnabled) {
    logger.info({ jobId: job.id }, 'SIGNAL: выгрузка выключена (SGNL_SYNC_ENABLED=false)');
    return;
  }
  const client = createSgnlClientFromEnv();
  if (!client) {
    logger.warn({ jobId: job.id }, 'SIGNAL: интеграция не настроена, прогон пропущен');
    return;
  }

  const downloader = createDownloader();
  try {
    const report = await runSgnlSync(
      {
        store: new DrizzleSgnlExportRepository(db),
        client,
        downloadFile: downloader.download,
        log: logger,
      },
      { dryRun: false, siteId: job.data.siteId },
    );
    await setSgnlLastRun(db, report);
    logger.info(
      { jobId: job.id, siteId: job.data.siteId ?? null, totals: report.totals },
      'SIGNAL: прогон выгрузки завершён',
    );
    if (report.aborted) throw new Error(`SIGNAL: прогон прерван — ${report.aborted}`);
  } finally {
    downloader.close();
  }
}

export interface SgnlSyncWorkerDeps {
  jobsLog?: JobsLogRepository;
  db?: BillhubDatabase;
}

function jobDurationMs(job: Job | undefined): number | null {
  if (job?.processedOn && job?.finishedOn) return job.finishedOn - job.processedOn;
  return null;
}

/** Регистрация (или снятие) ежедневного расписания по SGNL_SYNC_CRON */
async function syncScheduler(): Promise<void> {
  if (config.sgnlSyncCron) {
    await sgnlSyncQueue.upsertJobScheduler(
      SCHEDULER_ID,
      { pattern: config.sgnlSyncCron },
      { name: 'run', data: {}, opts: { attempts: 1 } },
    );
    logger.info({ cron: config.sgnlSyncCron }, 'SIGNAL: расписание выгрузки зарегистрировано');
  } else {
    await sgnlSyncQueue.removeJobScheduler(SCHEDULER_ID);
  }
}

/** Создание и запуск воркера выгрузки; регистрирует расписание */
export function createSgnlSyncWorker(deps: SgnlSyncWorkerDeps = {}): Worker<SgnlSyncJobData> {
  const worker = new Worker<SgnlSyncJobData>(
    QUEUE_NAME,
    async (job) => {
      if (!deps.db) throw new Error('sgnl-sync: Drizzle db не инициализирован');
      await processRun(job, deps.db);
    },
    { connection: parseRedisUrl(config.redisUrl), concurrency: 1 },
  );

  void syncScheduler().catch((err: unknown) =>
    logger.error({ err }, 'SIGNAL: не удалось обновить расписание выгрузки'),
  );

  const record = (job: Job<SgnlSyncJobData>, completed: boolean, error?: string): void => {
    if (!deps.jobsLog) return;
    void recordJobResult(
      deps.jobsLog,
      {
        queueName: QUEUE_NAME,
        jobId: String(job.id ?? ''),
        type: job.name,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 1,
        durationMs: jobDurationMs(job),
        error: error ?? null,
        completed,
      },
      (err) => logger.error({ err }, 'jobs_log запись не удалась'),
    );
  };

  worker.on('completed', (job) => record(job, true));
  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err: err.message },
      'SIGNAL: прогон выгрузки завершился ошибкой',
    );
    if (job) record(job, false, err.message);
  });
  worker.on('error', (err) => {
    logger.error({ err: err.message }, 'Ошибка воркера sgnl-sync');
  });

  return worker;
}
