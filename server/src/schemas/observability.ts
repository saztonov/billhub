/**
 * zod-схемы домена «observability» (Iteration 7): outbox / audit_log / jobs_log.
 *
 * Это контрактные схемы вход/выходных данных репозиториев (не тела HTTP-запросов —
 * эти таблицы не имеют публичных write-эндпоинтов). Используются для валидации payload
 * перед записью и как single-source-of-truth типов.
 */
import { z } from 'zod';

/** JSONB-payload — произвольный объект (валидируется как запись). */
export const jsonObjectSchema = z.record(z.string(), z.unknown());

/* --------------------------------- outbox ---------------------------------- */

export const outboxEventInputSchema = z.object({
  aggregateType: z.string().min(1),
  aggregateId: z.string().uuid(),
  eventType: z.string().min(1),
  payload: jsonObjectSchema.default({}),
});
export type OutboxEventInput = z.infer<typeof outboxEventInputSchema>;

export const outboxRowSchema = outboxEventInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string(),
  processedAt: z.string().nullable(),
});
export type OutboxRow = z.infer<typeof outboxRowSchema>;

/* -------------------------------- audit_log -------------------------------- */

export const auditLogEntryInputSchema = z.object({
  actorUserId: z.string().uuid().nullable().optional(),
  actorEmailHmac: z.string().nullable().optional(),
  eventType: z.string().min(1),
  targetType: z.string().nullable().optional(),
  targetId: z.string().uuid().nullable().optional(),
  payload: jsonObjectSchema.default({}),
});
export type AuditLogEntryInput = z.infer<typeof auditLogEntryInputSchema>;

/* --------------------------------- jobs_log -------------------------------- */

export const jobStatusSchema = z.enum(['done', 'failed', 'dead']);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobsLogEntryInputSchema = z.object({
  queueName: z.string().min(1),
  jobId: z.string().min(1),
  type: z.string().min(1),
  status: jobStatusSchema,
  attempts: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
});
export type JobsLogEntryInput = z.infer<typeof jobsLogEntryInputSchema>;
