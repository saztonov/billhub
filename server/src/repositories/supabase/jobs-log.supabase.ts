/**
 * Supabase-заглушка JobsLogRepository. Отчётность по задачам ведётся только в Drizzle-режиме.
 * Принцип 2: throw-not-supported.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobsLogRepository } from '../jobs-log.repository.js';
import type { JobsLogEntryInput } from '../../schemas/observability.js';

const NOT_SUPPORTED = 'JobsLog is Drizzle-only';

export class SupabaseJobsLogRepository implements JobsLogRepository {
  constructor(_supabase: SupabaseClient) {}

  record(_entry: JobsLogEntryInput): Promise<void> {
    throw new Error(NOT_SUPPORTED);
  }
  countDeadSince(_sinceIso: string): Promise<number> {
    throw new Error(NOT_SUPPORTED);
  }
  deleteByRetention(_doneCutoffIso: string, _failedDeadCutoffIso: string): Promise<number> {
    throw new Error(NOT_SUPPORTED);
  }
}
