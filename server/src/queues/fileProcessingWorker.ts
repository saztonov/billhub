import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { sql } from 'drizzle-orm';
import { config } from '../config.js';
import { parseRedisUrl } from './index.js';
import type { BillhubDatabase } from '../plugins/database-drizzle.js';
import type { JobsLogRepository } from '../repositories/jobs-log.repository.js';
import { recordJobResult } from '../services/observability/jobs-log.recorder.js';
import { createObservabilityLogger } from '../services/observability/logger.js';

/** Логгер воркера (вне контекста Fastify) с redaction (Iteration 7) */
const logger = createObservabilityLogger('file-processing-worker');

/** Данные задачи обработки файла */
export interface FileProcessingJobData {
  entityType:
    | 'payment_request_files'
    | 'approval_decision_files'
    | 'contract_request_files'
    | 'payment_payment_files'
    | 'founding_document_files';
  entityId: string;
  fileId: string;
  fileKey: string;
  userId: string;
}

/**
 * Маппинг entityType -> родительская таблица и поле счётчика.
 * Для типов без счётчика значение null.
 */
const COUNTER_MAP: Record<
  FileProcessingJobData['entityType'],
  { table: string; idField: string; counterField: string } | null
> = {
  payment_request_files: {
    table: 'payment_requests',
    idField: 'id',
    counterField: 'uploaded_files',
  },
  contract_request_files: {
    table: 'contract_requests',
    idField: 'id',
    counterField: 'uploaded_files',
  },
  approval_decision_files: null,
  payment_payment_files: null,
  founding_document_files: null,
};

/** Обработка одной задачи. db — Drizzle-клиент (обязателен для счётчиков файлов). */
async function processFileJob(
  job: Job<FileProcessingJobData>,
  db: BillhubDatabase | undefined,
): Promise<void> {
  const { entityType, entityId, fileId, fileKey } = job.data;

  logger.info({ jobId: job.id, entityType, entityId, fileId }, 'Начало обработки файла');

  await job.updateProgress(10);

  /** Обновление счётчика загруженных файлов (если применимо) — атомарный SQL-инкремент. */
  const counterConfig = COUNTER_MAP[entityType];

  if (counterConfig) {
    if (!db) {
      throw new Error('file-processing: Drizzle db не инициализирован — счётчик не обновить');
    }
    const { table, idField, counterField } = counterConfig;

    // Атомарно: uploaded_files = uploaded_files + 1 — без read-modify-write, без гонок при
    // параллельных загрузках. Имена table/idField/counterField — из хардкод-константы COUNTER_MAP
    // (не пользовательский ввод), поэтому sql.identifier безопасен.
    const rows = (await db.execute(sql`
      UPDATE ${sql.identifier(table)}
      SET ${sql.identifier(counterField)} = ${sql.identifier(counterField)} + 1
      WHERE ${sql.identifier(idField)} = ${entityId}
      RETURNING ${sql.identifier(counterField)} AS new_count
    `)) as unknown as Array<{ new_count: number }>;

    if (rows.length === 0) {
      throw new Error(`file-processing: строка не найдена (${table}.${idField}=${entityId})`);
    }

    logger.info({ table, entityId, newCount: rows[0]!.new_count }, 'Счётчик файлов обновлён');
  }

  await job.updateProgress(100);

  logger.info({ jobId: job.id, fileKey }, 'Обработка файла завершена');
}

/** Зависимости воркера обработки файлов (Iteration 7): отчётность в jobs_log. */
export interface FileProcessingWorkerDeps {
  jobsLog?: JobsLogRepository;
  /** Drizzle-клиент для атомарного обновления счётчиков файлов. */
  db?: BillhubDatabase;
}

/** Длительность выполнения задачи (мс) по таймштампам BullMQ, либо null. */
function jobDurationMs(job: Job | undefined): number | null {
  if (job?.processedOn && job?.finishedOn) return job.finishedOn - job.processedOn;
  return null;
}

/** Создание и запуск воркера */
export function createFileProcessingWorker(
  deps: FileProcessingWorkerDeps = {},
): Worker<FileProcessingJobData> {
  const connection = parseRedisUrl(config.redisUrl);

  const worker = new Worker<FileProcessingJobData>(
    'file-processing',
    (job) => processFileJob(job, deps.db),
    {
      connection,
      // FILE_PROCESSING_CONCURRENCY (Iteration 8). По умолчанию 3.
      concurrency: config.fileProcessingConcurrency,
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Задача успешно завершена');
    if (deps.jobsLog) {
      void recordJobResult(
        deps.jobsLog,
        {
          queueName: 'file-processing',
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
    logger.error({ jobId: job?.id, err: err.message }, 'Задача завершилась с ошибкой');
    if (deps.jobsLog && job) {
      void recordJobResult(
        deps.jobsLog,
        {
          queueName: 'file-processing',
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
    logger.error({ err: err.message }, 'Ошибка воркера');
  });

  return worker;
}
