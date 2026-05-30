/**
 * Общие zod-схемы и валидаторы.
 * Все доменные схемы наследуют отсюда базовые типы (UUID, ISO-дата, email и т.д.).
 */
import { z } from 'zod';

/** UUID v4 */
export const uuidSchema = z.uuid({ message: 'Неверный формат UUID' });

/** Непустая строка */
export const nonEmptyString = z.string().min(1, 'Поле не может быть пустым');

/** Email (с валидацией ASCII-формата) */
export const emailSchema = z.email({ message: 'Неверный формат email' }).max(255);

/** ИНН: 10 или 12 цифр */
export const innSchema = z
  .string()
  .regex(/^\d{10}$|^\d{12}$/, 'ИНН должен содержать 10 или 12 цифр');

/** ISO-дата (формат YYYY-MM-DD) */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата должна быть в формате YYYY-MM-DD');

/** Параметры пагинации */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

/** Поиск по тексту */
export const searchSchema = z.object({
  search: z.string().optional(),
});

/** Стандартный ответ list-метода с пагинацией */
export function paginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    totalCount: z.number().int().min(0),
  });
}

/** Стандартный ответ-обёртка для ошибок */
export const errorResponseSchema = z.object({
  error: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
