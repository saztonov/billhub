import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import type { Worker } from 'bullmq';
import { fileProcessingQueue, ocrQueue } from '../queues/index.js';
import { createFileProcessingWorker } from '../queues/fileProcessingWorker.js';
import type { FileProcessingJobData } from '../queues/fileProcessingWorker.js';
import { createOcrWorker } from '../queues/ocrWorker.js';
import type { OcrJobData } from '../queues/ocrWorker.js';

/** Плагин BullMQ очередей для Fastify */
async function queuesPlugin(fastify: FastifyInstance): Promise<void> {
  /** Запуск воркеров */
  const fileWorker: Worker<FileProcessingJobData> = createFileProcessingWorker();
  const ocrWorker: Worker<OcrJobData> = createOcrWorker();

  fastify.log.info('BullMQ воркеры запущены');

  /** Декорация — доступ к очередям через fastify.fileProcessingQueue / fastify.ocrQueue */
  fastify.decorate('fileProcessingQueue', fileProcessingQueue);
  fastify.decorate('ocrQueue', ocrQueue);

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
