/**
 * zod-схемы тел запросов для назначений специалистов (assignments).
 */
import { z } from 'zod';

export const createAssignmentBodySchema = z.object({
  paymentRequestId: z.string(),
  assignedUserId: z.string(),
});
export type CreateAssignmentBody = z.infer<typeof createAssignmentBodySchema>;
