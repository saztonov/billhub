/**
 * zod-схемы тел запросов для материалов (materials).
 */
import { z } from 'zod';

export const updateEstimateBodySchema = z.object({
  estimateQuantity: z.number().nullable(),
});
export type UpdateEstimateBody = z.infer<typeof updateEstimateBodySchema>;
