/**
 * Запись результата BullMQ-задачи в jobs_log (стандарт v3 раздел 21, план Iteration 7).
 *
 * Классификация статуса (classifyJobStatus) — чистая функция (unit-тестируема без БД):
 *   completed              → 'done'
 *   failed, попытки исчерпаны (attemptsMade ≥ maxAttempts) → 'dead' (алертится мониторингом)
 *   failed, попытки остались → 'failed' (будет ретрай)
 */
import type { JobsLogRepository } from '../../repositories/jobs-log.repository.js';
import type { JobStatus } from '../../schemas/observability.js';

export interface JobResultInput {
  queueName: string;
  jobId: string;
  type: string;
  attemptsMade: number;
  maxAttempts: number;
  durationMs: number | null;
  error?: string | null;
  completed: boolean;
}

/** Чистая классификация финального статуса задачи. */
export function classifyJobStatus(input: {
  completed: boolean;
  attemptsMade: number;
  maxAttempts: number;
}): JobStatus {
  if (input.completed) return 'done';
  return input.attemptsMade >= input.maxAttempts ? 'dead' : 'failed';
}

/** Записать результат задачи в jobs_log. Не бросает в вызывающий код — сам логирует ошибку. */
export async function recordJobResult(
  repo: JobsLogRepository,
  input: JobResultInput,
  onError?: (err: unknown) => void,
): Promise<void> {
  try {
    await repo.record({
      queueName: input.queueName,
      jobId: input.jobId,
      type: input.type,
      status: classifyJobStatus(input),
      attempts: input.attemptsMade,
      lastError: input.error ?? null,
      durationMs: input.durationMs,
    });
  } catch (err) {
    onError?.(err);
  }
}
