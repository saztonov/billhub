/**
 * zod-схемы для домена «Контрагент».
 */
import { z } from 'zod';
import {
  uuidSchema,
  nonEmptyString,
  innSchema,
  paginationSchema,
  searchSchema,
  paginatedResponseSchema,
} from './common.js';

/** Статус проверки СБ контрагента (миграция 001) */
export const counterpartySecurityStatusSchema = z.enum(['approved', 'rejected']);
export type CounterpartySecurityStatus = z.infer<typeof counterpartySecurityStatusSchema>;

/** Полный DTO контрагента (response) */
export const counterpartySchema = z.object({
  id: uuidSchema,
  name: nonEmptyString.max(500),
  inn: innSchema,
  address: z.string().default(''),
  alternativeNames: z.array(z.string()).default([]),
  registrationToken: z.string().nullable().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  /** Последний статус решения СБ или null (миграция 001) */
  lastSecurityStatus: counterpartySecurityStatusSchema.nullable().optional(),
  /** Есть ли pending-запрос проверки СБ */
  hasPendingRequest: z.boolean().optional(),
});
export type Counterparty = z.infer<typeof counterpartySchema>;

/** Создание контрагента (request body) */
export const createCounterpartyBodySchema = z.object({
  name: nonEmptyString.max(500),
  inn: innSchema,
  address: z.string().optional(),
  alternativeNames: z.array(z.string()).optional(),
});
export type CreateCounterpartyBody = z.infer<typeof createCounterpartyBodySchema>;

/** Обновление контрагента (request body) */
export const updateCounterpartyBodySchema = z.object({
  name: nonEmptyString.max(500).optional(),
  inn: innSchema.optional(),
  address: z.string().optional(),
  alternativeNames: z.array(z.string()).optional(),
});
export type UpdateCounterpartyBody = z.infer<typeof updateCounterpartyBodySchema>;

/** Query-фильтр списка контрагентов (с СБ-агрегатами через list_counterparties_with_sb) */
export const listCounterpartiesQuerySchema = paginationSchema.merge(searchSchema).extend({
  /** Фильтр по статусу СБ: pending показывает только незавершённые проверки */
  sbFilter: z.enum(['all', 'pending']).default('all'),
  /** Точная дата отсечки для pending (используется в RPC) */
  cutoffDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Ограничение по конкретному id (для security-роли) */
  onlyCounterpartyId: uuidSchema.optional(),
});
export type ListCounterpartiesQuery = z.infer<typeof listCounterpartiesQuerySchema>;

/** Ответ list-метода */
export const listCounterpartiesResponseSchema = paginatedResponseSchema(counterpartySchema);
export type ListCounterpartiesResponse = z.infer<typeof listCounterpartiesResponseSchema>;
