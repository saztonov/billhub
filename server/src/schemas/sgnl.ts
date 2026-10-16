/**
 * Zod-схемы интеграции SIGNAL DOCS (/api/sgnl).
 */
import { z } from 'zod';
import { uuidSchema } from './common.js';

/** Тело POST /api/sgnl/preview и /api/sgnl/run: необязательный фильтр по объекту */
export const sgnlRunBodySchema = z
  .object({
    siteId: uuidSchema.optional(),
  })
  .default({});

/** Query GET /api/sgnl/errors */
export const sgnlErrorsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
