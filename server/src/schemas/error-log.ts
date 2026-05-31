/**
 * zod-схемы тел запросов для логов ошибок (error-logs).
 */
import { z } from 'zod';

export const createErrorLogBodySchema = z.object({
  errorType: z.string(),
  errorMessage: z.string(),
  errorStack: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  component: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type CreateErrorLogBody = z.infer<typeof createErrorLogBodySchema>;

export const bulkDeleteErrorLogBodySchema = z.object({
  olderThanDays: z.number().int(),
});
export type BulkDeleteErrorLogBody = z.infer<typeof bulkDeleteErrorLogBodySchema>;
