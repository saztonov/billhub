/**
 * zod-схемы тел запросов для назначений этапа «РП» (rp-stage).
 */
import { z } from 'zod';

export const rpStageAssigneeBodySchema = z.object({
  siteId: z.string().uuid(),
  userId: z.string().uuid(),
});
export type RpStageAssigneeBody = z.infer<typeof rpStageAssigneeBodySchema>;
