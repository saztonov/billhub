/**
 * DrizzleJobsLogRepository (Iteration 7). Отчётность по BullMQ-задачам (раздел 21).
 * Требует живой PostgreSQL (testcontainers).
 */
import { and, count, eq, gte, inArray, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { jobsLog } from '../../db/schema/index.js';
import type { JobsLogRepository } from '../jobs-log.repository.js';
import type { JobsLogEntryInput } from '../../schemas/observability.js';

type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleJobsLogRepository implements JobsLogRepository {
  constructor(private readonly db: Db) {}

  async record(entry: JobsLogEntryInput): Promise<void> {
    await this.db.insert(jobsLog).values({
      queueName: entry.queueName,
      jobId: entry.jobId,
      type: entry.type,
      status: entry.status,
      attempts: entry.attempts ?? 0,
      lastError: entry.lastError ?? null,
      durationMs: entry.durationMs ?? null,
    });
  }

  async countDeadSince(sinceIso: string): Promise<number> {
    const [c] = await this.db
      .select({ c: count() })
      .from(jobsLog)
      .where(and(eq(jobsLog.status, 'dead'), gte(jobsLog.createdAt, sinceIso)));
    return Number(c?.c ?? 0);
  }

  async deleteByRetention(doneCutoffIso: string, failedDeadCutoffIso: string): Promise<number> {
    const doneDeleted = await this.db
      .delete(jobsLog)
      .where(and(eq(jobsLog.status, 'done'), lt(jobsLog.createdAt, doneCutoffIso)))
      .returning({ id: jobsLog.id });
    const failedDeleted = await this.db
      .delete(jobsLog)
      .where(
        and(
          inArray(jobsLog.status, ['failed', 'dead']),
          lt(jobsLog.createdAt, failedDeadCutoffIso),
        ),
      )
      .returning({ id: jobsLog.id });
    return doneDeleted.length + failedDeleted.length;
  }
}
