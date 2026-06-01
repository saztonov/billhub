/**
 * Unit-тесты классификации статуса задачи и записи в jobs_log.
 */
import { describe, it, expect, vi } from 'vitest';
import { classifyJobStatus, recordJobResult } from './jobs-log.recorder.js';
import type { JobsLogRepository } from '../../repositories/jobs-log.repository.js';
import type { JobsLogEntryInput } from '../../schemas/observability.js';

describe('jobs-log.recorder: classifyJobStatus', () => {
  it('completed → done', () => {
    expect(classifyJobStatus({ completed: true, attemptsMade: 1, maxAttempts: 3 })).toBe('done');
  });
  it('failed с оставшимися попытками → failed', () => {
    expect(classifyJobStatus({ completed: false, attemptsMade: 1, maxAttempts: 3 })).toBe('failed');
  });
  it('failed, попытки исчерпаны → dead', () => {
    expect(classifyJobStatus({ completed: false, attemptsMade: 3, maxAttempts: 3 })).toBe('dead');
    expect(classifyJobStatus({ completed: false, attemptsMade: 4, maxAttempts: 3 })).toBe('dead');
  });
});

class FakeJobsLog implements JobsLogRepository {
  records: JobsLogEntryInput[] = [];
  async record(entry: JobsLogEntryInput): Promise<void> {
    this.records.push(entry);
  }
  async countDeadSince(): Promise<number> {
    return 0;
  }
  async deleteByRetention(): Promise<number> {
    return 0;
  }
}

describe('jobs-log.recorder: recordJobResult', () => {
  it('пишет done с длительностью и attempts', async () => {
    const repo = new FakeJobsLog();
    await recordJobResult(repo, {
      queueName: 'ocr-processing',
      jobId: '42',
      type: 'ocr',
      attemptsMade: 1,
      maxAttempts: 3,
      durationMs: 1234,
      completed: true,
    });
    expect(repo.records).toHaveLength(1);
    expect(repo.records[0]).toMatchObject({ status: 'done', durationMs: 1234, jobId: '42' });
  });

  it('dead при исчерпании попыток + last_error', async () => {
    const repo = new FakeJobsLog();
    await recordJobResult(repo, {
      queueName: 'file-processing',
      jobId: '7',
      type: 'file',
      attemptsMade: 3,
      maxAttempts: 3,
      durationMs: null,
      error: 'boom',
      completed: false,
    });
    expect(repo.records[0]).toMatchObject({ status: 'dead', lastError: 'boom' });
  });

  it('ошибка записи не пробрасывается, зовётся onError', async () => {
    const repo: JobsLogRepository = {
      record: vi.fn().mockRejectedValue(new Error('db down')),
      countDeadSince: vi.fn(),
      deleteByRetention: vi.fn(),
    };
    const onError = vi.fn();
    await expect(
      recordJobResult(
        repo,
        {
          queueName: 'q',
          jobId: '1',
          type: 't',
          attemptsMade: 1,
          maxAttempts: 1,
          durationMs: null,
          completed: true,
        },
        onError,
      ),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });
});
