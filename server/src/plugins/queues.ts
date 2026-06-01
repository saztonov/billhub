import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import type { Worker } from 'bullmq';
import { config } from '../config.js';
import { fileProcessingQueue, ocrQueue } from '../queues/index.js';
import { createFileProcessingWorker } from '../queues/fileProcessingWorker.js';
import type { FileProcessingJobData } from '../queues/fileProcessingWorker.js';
import { createOcrWorker } from '../queues/ocrWorker.js';
import type { OcrJobData } from '../queues/ocrWorker.js';
import { DrizzleJobsLogRepository } from '../repositories/drizzle/jobs-log.drizzle.js';
import type { JobsLogRepository } from '../repositories/jobs-log.repository.js';

/**
 * Плагин BullMQ очередей для Fastify.
 *
 * Iteration 8 — разделение API/worker. Очереди (для enqueue из роутов) регистрируются ВСЕГДА.
 * Воркеры стартуют только при config.runWorkers (RUN_WORKERS!=false): в production-compose
 * API-контейнер ставит RUN_WORKERS=false (только enqueue), worker-контейнер — RUN_WORKERS=true.
 * Это даёт 2 процесса в connection budget (ADR-0005). В dev/одиночном compose флаг по умолчанию
 * true — обратная совместимость (воркеры в том же процессе).
 */
async function queuesPlugin(fastify: FastifyInstance): Promise<void> {
  /** Декорация — доступ к очередям через fastify.fileProcessingQueue / fastify.ocrQueue */
  fastify.decorate('fileProcessingQueue', fileProcessingQueue);
  fastify.decorate('ocrQueue', ocrQueue);

  if (!config.runWorkers) {
    fastify.log.info('queues: RUN_WORKERS=false — только очереди (enqueue), воркеры не запущены');
    fastify.addHook('onClose', async () => {
      await fileProcessingQueue.close();
      await ocrQueue.close();
    });
    return;
  }

  // Iteration 7: при Drizzle (production) воркеры пишут результат в jobs_log.
  const jobsLog: JobsLogRepository | undefined = fastify.db
    ? new DrizzleJobsLogRepository(fastify.db)
    : undefined;

  /** Запуск воркеров */
  const fileWorker: Worker<FileProcessingJobData> = createFileProcessingWorker({ jobsLog });
  const ocrWorker: Worker<OcrJobData> = createOcrWorker({ jobsLog });

  fastify.log.info('BullMQ воркеры запущены');

  /** Корректное завершение: сначала воркеры, потом очереди */
  fastify.addHook('onClose', async () => {
    fastify.log.info('Остановка BullMQ воркеров...');

    await fileWorker.close();
    await ocrWorker.close();

    await fileProcessingQueue.close();
    await ocrQueue.close();

    fastify.log.info('BullMQ воркеры и очереди закрыты');
  });
}

/** Расширение типов FastifyInstance */
declare module 'fastify' {
  interface FastifyInstance {
    fileProcessingQueue: Queue<FileProcessingJobData>;
    ocrQueue: Queue<OcrJobData>;
  }
}

export default fp(queuesPlugin, {
  name: 'queues',
  dependencies: ['redis'],
});
