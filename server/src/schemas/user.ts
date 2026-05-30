/**
 * zod-схемы для домена «Пользователь».
 */
import { z } from 'zod';
import { uuidSchema, nonEmptyString, emailSchema, paginationSchema } from './common.js';

/** Роли пользователей (синхронизировано с UserRole из src/types) */
export const userRoleSchema = z.enum(['admin', 'user', 'counterparty_user', 'security']);
export type UserRole = z.infer<typeof userRoleSchema>;

/** Отделы (для штатных user) */
export const departmentSchema = z.enum(['omts', 'shtab', 'smetny']).nullable();
export type Department = z.infer<typeof departmentSchema>;

/** Полный DTO пользователя для UI (без password_hash и других секретов) */
export const userSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  fullName: nonEmptyString.max(255),
  role: userRoleSchema,
  counterpartyId: uuidSchema.nullable(),
  department: departmentSchema,
  allSites: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
});
export type User = z.infer<typeof userSchema>;

/** Создание пользователя (admin / api) */
export const createUserBodySchema = z
  .object({
    email: emailSchema,
    password: z.string().min(8, 'Минимум 8 символов').max(128),
    fullName: nonEmptyString.max(255),
    role: userRoleSchema,
    counterpartyId: uuidSchema.optional().nullable(),
    department: departmentSchema.optional(),
    allSites: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // counterparty_user обязан иметь counterpartyId
      if (data.role === 'counterparty_user' && !data.counterpartyId) return false;
      return true;
    },
    {
      message: 'counterparty_user обязан иметь counterpartyId',
      path: ['counterpartyId'],
    },
  );
export type CreateUserBody = z.infer<typeof createUserBodySchema>;

/** Обновление */
export const updateUserBodySchema = z.object({
  email: emailSchema.optional(),
  fullName: nonEmptyString.max(255).optional(),
  role: userRoleSchema.optional(),
  counterpartyId: uuidSchema.optional().nullable(),
  department: departmentSchema.optional(),
  allSites: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;

/** Список пользователей с пагинацией */
export const listUsersQuerySchema = paginationSchema.extend({
  role: userRoleSchema.optional(),
  counterpartyId: uuidSchema.optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/** Расширенный DTO пользователя для admin-таблицы (имя контрагента + привязанные объекты) */
export const userDetailSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: z.string(),
  counterpartyId: z.string().nullable(),
  counterpartyName: z.string().nullable(),
  department: z.string().nullable(),
  allSites: z.boolean(),
  isActive: z.boolean(),
  siteIds: z.array(z.string()),
  siteNames: z.array(z.string()),
  createdAt: z.string().optional(),
});
export type UserDetail = z.infer<typeof userDetailSchema>;

/**
 * Тело PUT /api/users/:id — исторически в snake_case (фронтенд отправляет full_name/site_ids).
 */
export const updateUserWithSitesBodySchema = z.object({
  full_name: nonEmptyString.max(255),
  role: userRoleSchema,
  counterparty_id: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  all_sites: z.boolean(),
  site_ids: z.array(z.string()),
});
export type UpdateUserWithSitesBody = z.infer<typeof updateUserWithSitesBodySchema>;

/** Тело PUT /api/users/:id/sites */
export const updateUserSitesBodySchema = z.object({
  siteIds: z.array(z.string()),
});
export type UpdateUserSitesBody = z.infer<typeof updateUserSitesBodySchema>;
