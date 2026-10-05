/**
 * zod-схема настройки «Порог этапа УОК» (settings/uok-threshold).
 */
import { z } from 'zod';

/** Тело PUT /api/settings/uok-threshold: сумма счёта в рублях, свыше которой нужен этап УОК. */
export const uokThresholdPutBodySchema = z.object({
  amount: z.number().finite().nonnegative().max(1_000_000_000_000),
});
export type UokThresholdPutBody = z.infer<typeof uokThresholdPutBodySchema>;
