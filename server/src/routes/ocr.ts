import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { fetchAvailableModels } from '../services/openrouter.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов OCR                                               */
/* ------------------------------------------------------------------ */

async function ocrRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };
  const adminOnly = { preHandler: [authenticate, requireRole('admin')] };

  /* ---------- POST /api/ocr/recognize/:paymentRequestId ---------- */
  /** Добавить заявку в очередь OCR-распознавания */
  fastify.post('/api/ocr/recognize/:paymentRequestId', adminOrUser, async (request, reply) => {
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    const userId = request.user?.id;

    if (!userId) {
      return reply.status(401).send({ error: 'Не авторизован' });
    }

    // Проверяем что заявка существует
    const { data: pr, error: prErr } = await fastify.supabase
      .from('payment_requests')
      .select('id')
      .eq('id', paymentRequestId)
      .single();

    if (prErr || !pr) {
      return reply.status(404).send({ error: 'Заявка не найдена' });
    }

    // Добавляем задачу в очередь
    const job = await fastify.ocrQueue.add(
      'ocr-recognize',
      { paymentRequestId, userId },
      {
        jobId: `ocr-${paymentRequestId}-${Date.now()}`,
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    );

    return reply.send({
      jobId: job.id,
      message: 'Задача OCR добавлена в очередь',
    });
  });

  /* ---------- GET /api/ocr/progress/:paymentRequestId ---------- */
  /** SSE-поток прогресса OCR */
  fastify.get('/api/ocr/progress/:paymentRequestId', adminOrUser, async (request, reply) => {
    const { paymentRequestId } = request.params as { paymentRequestId: string };

    // Настраиваем SSE
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Ищем активную задачу для этой заявки
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

    // Отправляем обновления прогресса каждые 500мс
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

        // Отправляем прогресс
        const progressData = typeof progress === 'object' ? progress : { percent: progress };
        reply.raw.write(`data: ${JSON.stringify(progressData)}\n\n`);
      } catch {
        clearInterval(intervalId);
        reply.raw.end();
      }
    }, 500);

    // Очистка при закрытии соединения
    request.raw.on('close', () => {
      clearInterval(intervalId);
    });
  });

  /* ---------- GET /api/ocr/models ---------- */
  /** Список доступных моделей OpenRouter */
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
  /** Получить настройки OCR */
  fastify.get('/api/ocr/settings', adminOrUser, async (_request, reply) => {
    const { data, error } = await fastify.supabase
      .from('settings')
      .select('key, value')
      .in('key', ['ocr_auto_enabled', 'ocr_active_model_id', 'ocr_models']);

    if (error) return reply.status(500).send({ error: error.message });

    const settings: Record<string, unknown> = {};
    for (const row of data ?? []) {
      settings[row.key as string] = row.value;
    }

    const autoVal = settings['ocr_auto_enabled'] as { enabled?: boolean } | undefined;
    const modelVal = settings['ocr_active_model_id'] as { modelId?: string } | undefined;
    const modelsVal = settings['ocr_models'] as { models?: unknown[] } | undefined;

    return reply.send({
      autoEnabled: autoVal?.enabled ?? false,
      activeModelId: modelVal?.modelId ?? '',
      models: modelsVal?.models ?? [],
    });
  });

  /* ---------- PUT /api/ocr/settings/auto-enabled ---------- */
  /** Включить/выключить авто-OCR */
  fastify.put('/api/ocr/settings/auto-enabled', adminOnly, async (request, reply) => {
    const { enabled } = request.body as { enabled: boolean };

    const { error } = await fastify.supabase
      .from('settings')
      .upsert({ key: 'ocr_auto_enabled', value: { enabled } }, { onConflict: 'key' });

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ success: true });
  });

  /* ---------- PUT /api/ocr/settings/active-model ---------- */
  /** Установить активную модель OCR */
  fastify.put('/api/ocr/settings/active-model', adminOnly, async (request, reply) => {
    const { modelId } = request.body as { modelId: string };

    const { error } = await fastify.supabase
      .from('settings')
      .upsert({ key: 'ocr_active_model_id', value: { modelId } }, { onConflict: 'key' });

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ success: true });
  });

  /* ---------- POST /api/ocr/models ---------- */
  /** Добавить модель OCR */
  fastify.post('/api/ocr/models', adminOnly, async (request, reply) => {
    const model = request.body as {
      id: string;
      name: string;
      inputPrice: number;
      outputPrice: number;
    };

    const { data: settingsData } = await fastify.supabase
      .from('settings')
      .select('value')
      .eq('key', 'ocr_models')
      .single();

    const current = (settingsData?.value as { models?: unknown[] } | null)?.models ?? [];
    const updated = [...current, model];

    const { error } = await fastify.supabase
      .from('settings')
      .upsert({ key: 'ocr_models', value: { models: updated } }, { onConflict: 'key' });

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ success: true });
  });

  /* ---------- PUT /api/ocr/models/:id ---------- */
  /** Обновить модель OCR */
  fastify.put('/api/ocr/models/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const partial = request.body as Record<string, unknown>;

    const { data: settingsData } = await fastify.supabase
      .from('settings')
      .select('value')
      .eq('key', 'ocr_models')
      .single();

    const current = (settingsData?.value as { models?: Record<string, unknown>[] } | null)?.models ?? [];
    const updated = current.map((m) => (m.id === id ? { ...m, ...partial } : m));

    const { error } = await fastify.supabase
      .from('settings')
      .upsert({ key: 'ocr_models', value: { models: updated } }, { onConflict: 'key' });

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ success: true });
  });

  /* ---------- DELETE /api/ocr/models/:id ---------- */
  /** Удалить модель OCR */
  fastify.delete('/api/ocr/models/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string };

    const { data: settingsData } = await fastify.supabase
      .from('settings')
      .select('value')
      .eq('key', 'ocr_models')
      .single();

    const current = (settingsData?.value as { models?: Record<string, unknown>[] } | null)?.models ?? [];
    const updated = current.filter((m) => m.id !== id);

    const { error } = await fastify.supabase
      .from('settings')
      .upsert({ key: 'ocr_models', value: { models: updated } }, { onConflict: 'key' });

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ success: true });
  });

  /* ---------- GET /api/ocr/logs ---------- */
  /** Логи OCR-распознавания с пагинацией */
  fastify.get('/api/ocr/logs', adminOrUser, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const page = parseInt(query.page ?? '1', 10);
    const pageSize = parseInt(query.pageSize ?? '50', 10);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Получаем общее количество
    const { count, error: countErr } = await fastify.supabase
      .from('ocr_recognition_log')
      .select('id', { count: 'exact', head: true });

    if (countErr) return reply.status(500).send({ error: countErr.message });

    // Получаем логи
    const { data, error } = await fastify.supabase
      .from('ocr_recognition_log')
      .select('id, payment_request_id, file_id, model_id, status, error_message, attempt_number, input_tokens, output_tokens, total_cost, created_at, completed_at')
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) return reply.status(500).send({ error: error.message });

    // Подгружаем номера заявок
    const prIds = [...new Set((data ?? []).map(
      (r: Record<string, unknown>) => r.payment_request_id as string,
    ))];

    const prMap: Record<string, string> = {};
    if (prIds.length > 0) {
      const { data: prData } = await fastify.supabase
        .from('payment_requests')
        .select('id, request_number')
        .in('id', prIds);

      for (const row of prData ?? []) {
        const r = row as Record<string, unknown>;
        prMap[r.id as string] = r.request_number as string;
      }
    }

    const logs = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      paymentRequestId: row.payment_request_id,
      requestNumber: prMap[row.payment_request_id as string] ?? '',
      fileId: row.file_id,
      modelId: row.model_id,
      status: row.status,
      errorMessage: row.error_message,
      attemptNumber: row.attempt_number,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalCost: row.total_cost,
      startedAt: row.created_at,
      completedAt: row.completed_at,
    }));

    return reply.send({ logs, total: count ?? 0 });
  });

  /* ---------- GET /api/ocr/token-stats ---------- */
  /** Статистика токенов по моделям */
  fastify.get('/api/ocr/token-stats', adminOrUser, async (_request, reply) => {
    const { data, error } = await fastify.supabase
      .from('ocr_recognition_log')
      .select('model_id, input_tokens, output_tokens, total_cost')
      .eq('status', 'success');

    if (error) return reply.status(500).send({ error: error.message });

    const stats: Record<string, { inputTokens: number; outputTokens: number; totalCost: number }> = {};

    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      const modelId = r.model_id as string;

      if (!stats[modelId]) {
        stats[modelId] = { inputTokens: 0, outputTokens: 0, totalCost: 0 };
      }

      const entry = stats[modelId];
      if (entry) {
        entry.inputTokens += Number(r.input_tokens ?? 0);
        entry.outputTokens += Number(r.output_tokens ?? 0);
        entry.totalCost += Number(r.total_cost ?? 0);
      }
    }

    return reply.send(stats);
  });
}

export default ocrRoutes;
