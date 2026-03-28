import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';

/** Параметры маршрута */
interface ProgressParams {
  jobId: string;
}

/** Схема валидации */
const progressSchema = {
  params: {
    type: 'object' as const,
    required: ['jobId'],
    properties: {
      jobId: { type: 'string' as const, minLength: 1 },
    },
  },
};

/** Маршруты отслеживания прогресса загрузки через SSE */
async function uploadProgressRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/files/upload-progress/:jobId
   * SSE-эндпоинт для отслеживания статуса задачи в очереди
   */
  fastify.get<{ Params: ProgressParams }>(
    '/api/files/upload-progress/:jobId',
    {
      preHandler: [authenticate],
      schema: progressSchema,
    },
    async (request: FastifyRequest<{ Params: ProgressParams }>, reply: FastifyReply) => {
      const { jobId } = request.params;

      /** SSE-заголовки */
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      /** Отправка SSE-события */
      const sendEvent = (data: Record<string, unknown>): void => {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      /** Флаг для предотвращения двойной очистки */
      let closed = false;

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
      };

      /** Опрос статуса задачи каждые 500мс */
      const interval = setInterval(async () => {
        if (closed) return;

        try {
          const job = await fastify.fileProcessingQueue.getJob(jobId);

          if (!job) {
            sendEvent({ type: 'error', message: 'Задача не найдена' });
            cleanup();
            reply.raw.end();
            return;
          }

          const state = await job.getState();
          const progress = job.progress;

          sendEvent({ type: 'progress', state, progress });

          if (state === 'completed' || state === 'failed') {
            cleanup();
            reply.raw.end();
          }
        } catch {
          cleanup();
          reply.raw.end();
        }
      }, 500);

      /** Очистка при отключении клиента */
      request.raw.on('close', cleanup);
    }
  );
}

export default fp(uploadProgressRoutes, {
  name: 'upload-progress-routes',
  dependencies: ['queues'],
});
