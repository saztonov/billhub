import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { fetchAvailableModels } from '../services/openrouter.js';
import {
  ocrAutoEnabledBodySchema,
  ocrActiveModelBodySchema,
  ocrPricingModelBodySchema,
  ocrUpdatePricingModelBodySchema,
} from '../schemas/ocr.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов OCR. БД-операции — через fastify.repos.ocr;       */
/*  очередь BullMQ, OpenRouter и SSE остаются в роуте.                 */
/* ------------------------------------------------------------------ */

async function ocrRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };
  const adminOnly = { preHandler: [authenticate, requireRole('admin')] };

  /* ---------- POST /api/ocr/recognize/:paymentRequestId ---------- */
  fastify.post('/api/ocr/recognize/:paymentRequestId', adminOrUser, async (request, reply) => {
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    const userId = request.user?.id;
    if (!userId) return reply.status(401).send({ error: 'Не авторизован' });

    if (!(await request.server.repos.ocr.paymentRequestExists(paymentRequestId))) {
      return reply.status(404).send({ error: 'Заявка не найдена' });
    }

    const job = await fastify.ocrQueue.add(
      'ocr-recognize',
      { paymentRequestId, userId },
      {
        jobId: `ocr-${paymentRequestId}-${Date.now()}`,
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    );

    return reply.send({ jobId: job.id, message: 'Задача OCR добавлена в очередь' });
  });

  /* ---------- GET /api/ocr/progress/:paymentRequestId (SSE) ---------- */
  fastify.get('/api/ocr/progress/:paymentRequestId', adminOrUser, async (request, reply) => {
    const { paymentRequestId } = request.params as { paymentRequestId: string };

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const jobs = await fastify.ocrQueue.getJobs(['active', 'waiting', 'delayed']);
    const activeJob = jobs.find((j) => {
      const data = j.data as unknown as Record<string, unknown>;
      return data.paymentRequestId === paymentRequestId;
    });

    if (!activeJob) {
      reply.raw.write(`data: ${JSON.stringify({ stage: 'not_found' })}\n\n`);
      reply.raw.end();
      return;
    }

    const intervalId = setInterval(async () => {
      try {
        const job = await fastify.ocrQueue.getJob(activeJob.id ?? '');
        if (!job) {
          reply.raw.write(`data: ${JSON.stringify({ stage: 'done', percent: 100 })}\n\n`);
          clearInterval(intervalId);
          reply.raw.end();
          return;
        }

        const state = await job.getState();
        const progress = job.progress as Record<string, unknown> | number;

        if (state === 'completed') {
          reply.raw.write(`data: ${JSON.stringify({ stage: 'done', percent: 100 })}\n\n`);
          clearInterval(intervalId);
          reply.raw.end();
          return;
        }
        if (state === 'failed') {
          const reason = job.failedReason ?? 'Неизвестная ошибка';
          reply.raw.write(`data: ${JSON.stringify({ stage: 'error', error: reason })}\n\n`);
          clearInterval(intervalId);
          reply.raw.end();
          return;
        }

        const progressData = typeof progress === 'object' ? progress : { percent: progress };
        reply.raw.write(`data: ${JSON.stringify(progressData)}\n\n`);
      } catch {
        clearInterval(intervalId);
        reply.raw.end();
      }
    }, 500);

    request.raw.on('close', () => clearInterval(intervalId));
  });

  /* ---------- GET /api/ocr/models (OpenRouter) ---------- */
  fastify.get('/api/ocr/models', adminOnly, async (_request, reply) => {
    try {
      const models = await fetchAvailableModels();
      return reply.send({ data: models });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка получения моделей';
      return reply.status(500).send({ error: msg });
    }
  });

  /* ---------- GET /api/ocr/settings ---------- */
  fastify.get('/api/ocr/settings', adminOrUser, async (request) => {
    return request.server.repos.ocr.getSettings();
  });

  /* ---------- PUT /api/ocr/settings/auto-enabled ---------- */
  fastify.put('/api/ocr/settings/auto-enabled', adminOnly, async (request) => {
    const body = ocrAutoEnabledBodySchema.parse(request.body);
    await request.server.repos.ocr.setAutoEnabled(body.enabled);
    return { success: true };
  });

  /* ---------- PUT /api/ocr/settings/active-model ---------- */
  fastify.put('/api/ocr/settings/active-model', adminOnly, async (request) => {
    const body = ocrActiveModelBodySchema.parse(request.body);
    await request.server.repos.ocr.setActiveModel(body.modelId);
    return { success: true };
  });

  /* ---------- POST /api/ocr/models ---------- */
  fastify.post('/api/ocr/models', adminOnly, async (request) => {
    const body = ocrPricingModelBodySchema.parse(request.body);
    await request.server.repos.ocr.addModel(body);
    return { success: true };
  });

  /* ---------- PUT /api/ocr/models/:id ---------- */
  fastify.put('/api/ocr/models/:id', adminOnly, async (request) => {
    const { id } = request.params as { id: string };
    const partial = ocrUpdatePricingModelBodySchema.parse(request.body);
    await request.server.repos.ocr.updateModel(id, partial);
    return { success: true };
  });

  /* ---------- DELETE /api/ocr/models/:id ---------- */
  fastify.delete('/api/ocr/models/:id', adminOnly, async (request) => {
    const { id } = request.params as { id: string };
    await request.server.repos.ocr.deleteModel(id);
    return { success: true };
  });

  /* ---------- GET /api/ocr/approved-requests ---------- */
  fastify.get('/api/ocr/approved-requests', adminOrUser, async (request) => {
    return request.server.repos.ocr.listApprovedRequests();
  });

  /* ---------- GET /api/ocr/test-llm (OpenRouter) ---------- */
  fastify.get('/api/ocr/test-llm', adminOnly, async (_request, reply) => {
    try {
      const models = await fetchAvailableModels();
      return reply.send({ count: models.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка проверки LLM';
      return reply.status(500).send({ error: msg });
    }
  });

  /* ---------- GET /api/ocr/queue/:taskId ---------- */
  fastify.get('/api/ocr/queue/:taskId', adminOrUser, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    try {
      const job = await fastify.ocrQueue.getJob(taskId);
      if (!job) return reply.status(404).send({ error: 'Задача не найдена' });

      const state = await job.getState();
      const progress = job.progress as Record<string, unknown> | number;
      return reply.send({
        jobId: job.id,
        state,
        progress: typeof progress === 'object' ? progress : { percent: progress },
        failedReason: job.failedReason ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка получения задачи';
      return reply.status(500).send({ error: msg });
    }
  });

  /* ---------- GET /api/ocr/logs ---------- */
  fastify.get('/api/ocr/logs', adminOrUser, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const page = parseInt(query.page ?? '1', 10);
    const pageSize = parseInt(query.pageSize ?? '50', 10);
    return request.server.repos.ocr.listLogs(page, pageSize);
  });

  /* ---------- GET /api/ocr/token-stats ---------- */
  fastify.get('/api/ocr/token-stats', adminOrUser, async (request) => {
    return request.server.repos.ocr.getTokenStats();
  });
}

export default ocrRoutes;
