/**
 * Zod-схемы интеграции PayHub (/api/payhub).
 */
import { z } from 'zod';

/** Тело PUT /api/payhub/rp-sender: контрагент-отправитель РП или null (очистка). */
export const rpSenderPutBodySchema = z.object({
  sender: z
    .object({
      contractorId: z.string().min(1).max(100),
      name: z.string().max(500).nullable().default(null),
      inn: z.string().max(20).nullable().default(null),
    })
    .nullable(),
});
