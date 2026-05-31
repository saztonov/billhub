/**
 * zod-схемы тел запросов для настроек ОМТС-РП (omts-rp).
 */
import { z } from 'zod';

export const omtsRpSitesBodySchema = z.object({
  action: z.enum(['add', 'remove']),
  siteId: z.string(),
});
export type OmtsRpSitesBody = z.infer<typeof omtsRpSitesBodySchema>;

export const omtsRpResponsibleBodySchema = z.object({
  userId: z.string().nullable(),
});
export type OmtsRpResponsibleBody = z.infer<typeof omtsRpResponsibleBodySchema>;
