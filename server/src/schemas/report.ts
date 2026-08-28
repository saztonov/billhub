/**
 * zod-схемы параметров отчётов (раздел «Администрирование» → «Отчёты»).
 */
import { z } from 'zod';

/** Месяц в формате YYYY-MM (границы периода включительно). */
const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Ожидается месяц в формате YYYY-MM');

export const savingsReportQuerySchema = z.object({
  from: monthSchema.optional(),
  to: monthSchema.optional(),
});
export type SavingsReportQuery = z.infer<typeof savingsReportQuerySchema>;
