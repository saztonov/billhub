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
export const fileProcessingQueue = new Queue<FileProcessingJobData>(
  'file-processing',
  {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  }
);

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
