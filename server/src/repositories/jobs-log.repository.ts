/**
 * Repository-интерфейс домена «jobs_log» (отчётность по BullMQ-задачам, стандарт v3 раздел 21).
 * Supabase-impl кидает not-supported (принцип 2: JobsLog is Drizzle-only).
 */
import type { JobsLogEntryInput } from '../schemas/observability.js';

export interface JobsLogRepository {
  /** Записать результат задачи (done/failed/dead). */
  record(entry: JobsLogEntryInput): Promise<void>;
  /** Кол-во dead-задач за окно (ISO since) — для алерта dead jobs. */
  countDeadSince(sinceIso: string): Promise<number>;
  /** Retention: удалить done старше doneCutoff и failed/dead старше failedCutoff (ISO).
   *  Возвращает суммарное число удалённых строк. */
  deleteByRetention(doneCutoffIso: string, failedDeadCutoffIso: string): Promise<number>;
}
