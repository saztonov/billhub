import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { config } from '../config.js';
import type { FileProcessingJobData } from './fileProcessingWorker.js';

/** Парсинг Redis URL в connection options для BullMQ */
export function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  };
}

const connection = parseRedisUrl(config.redisUrl);

/** Очередь обработки файлов (после загрузки) */
export const fileProcessingQueue = new Queue<FileProcessingJobData>('file-processing', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

/** Очередь OCR-распознавания счетов */
export const ocrQueue = new Queue('ocr-processing', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
  },
});

/** Данные задачи синхронизации письма РП с PayHub (sweep-задача — без rpLetterId) */
export interface PayhubLetterJobData {
  rpLetterId?: string;
}

/**
 * Очередь синхронизации писем РП с PayHub (0008).
 * Ретраи с растущим интервалом: 30с, 1м, 2м, ... (exponential) — «PayHub недоступен»
 * лечится автоматически. Состояния ожидания конфигурации попытки НЕ расходуют
 * (задача завершается успешно со статусом waiting_config, sweep переставит её позже).
 * removeOnComplete/removeOnFail: true — история в jobs_log и в rp_letters;
 * записи в Redis удаляются, чтобы детерминированный jobId можно было ставить повторно.
 */
export const payhubLetterQueue = new Queue<PayhubLetterJobData>('payhub-letter-sync', {
  connection,
  defaultJobOptions: {
    attempts: 10,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: true,
  },
});

/** Детерминированный jobId — защита от дублей задач по одной РП */
export function rpLetterJobId(rpLetterId: string): string {
  return `rp-letter-${rpLetterId}`;
}

/** Поставить синхронизацию письма РП в очередь (идемпотентно по jobId). */
export async function enqueueRpLetterSync(rpLetterId: string): Promise<void> {
  await payhubLetterQueue.add('sync', { rpLetterId }, { jobId: rpLetterJobId(rpLetterId) });
}
