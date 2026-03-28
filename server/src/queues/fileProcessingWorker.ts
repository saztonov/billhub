import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { createClient } from '@supabase/supabase-js';
import pino from 'pino';
import { config } from '../config.js';
import { parseRedisUrl } from './index.js';

/** Логгер воркера (вне контекста Fastify) */
const logger = pino({ name: 'file-processing-worker' });

/** Данные задачи обработки файла */
export interface FileProcessingJobData {
  entityType:
    | 'payment_request_files'
    | 'approval_decision_files'
    | 'contract_request_files'
    | 'payment_payment_files';
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
};

/** Supabase клиент для воркера (service role) */
const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

/** Обработка одной задачи */
async function processFileJob(job: Job<FileProcessingJobData>): Promise<void> {
  const { entityType, entityId, fileId, fileKey } = job.data;

  logger.info(
    { jobId: job.id, entityType, entityId, fileId },
    'Начало обработки файла'
  );

  await job.updateProgress(10);

  /** Обновление счётчика загруженных файлов (если применимо) */
  const counterConfig = COUNTER_MAP[entityType];

  if (counterConfig) {
    const { table, idField, counterField } = counterConfig;

    /** Получаем текущее значение счётчика */
    const { data, error: fetchError } = await supabase
      .from(table)
      .select(counterField)
      .eq(idField, entityId)
      .single();

    if (fetchError) {
      logger.error(
        { err: fetchError, table, entityId },
        'Ошибка получения текущего значения счётчика'
      );
      throw new Error(`Ошибка чтения ${table}: ${fetchError.message}`);
    }

    const record = data as unknown as Record<string, unknown> | null;
    const currentCount = (record?.[counterField] as number) ?? 0;

    const { error: updateError } = await supabase
      .from(table)
      .update({ [counterField]: currentCount + 1 })
      .eq(idField, entityId);

    if (updateError) {
      logger.error(
        { err: updateError, table, entityId },
        'Ошибка обновления счётчика'
      );
      throw new Error(`Ошибка обновления ${table}: ${updateError.message}`);
    }

    logger.info(
      { table, entityId, newCount: currentCount + 1 },
      'Счётчик файлов обновлён'
    );
  }

  await job.updateProgress(100);

  logger.info(
    { jobId: job.id, fileKey },
    'Обработка файла завершена'
  );
}

/** Создание и запуск воркера */
export function createFileProcessingWorker(): Worker<FileProcessingJobData> {
  const connection = parseRedisUrl(config.redisUrl);

  const worker = new Worker<FileProcessingJobData>(
    'file-processing',
    processFileJob,
    {
      connection,
      concurrency: 3,
    }
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Задача успешно завершена');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err: err.message },
      'Задача завершилась с ошибкой'
    );
  });

  worker.on('error', (err) => {
    logger.error({ err: err.message }, 'Ошибка воркера');
  });

  return worker;
}
