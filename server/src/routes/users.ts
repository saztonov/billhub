import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { PasswordService } from '../services/auth/password.service.js';
import { updateUserWithSitesBodySchema, updateUserSitesBodySchema } from '../schemas/user.js';

/* ------------------------------------------------------------------ */
/*  Параметры пути и тела                                              */
/* ------------------------------------------------------------------ */

interface IdParams {
  id: string;
}

const idParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'],
    properties: { id: { type: 'string' as const, minLength: 1 } },
  },
};

const patchBodySchema = z.object({ isActive: z.boolean().optional() });

/** Batch-import создаёт пользователей-подрядчиков (standalone auth: bcrypt-хэш в public.users). */
const batchRowSchema = z.object({
  counterpartyId: z.string(),
  email: z.string(),
  password: z.string(),
  fullName: z.string(),
});
const batchImportBodySchema = z.union([
  z.object({ rows: z.array(batchRowSchema).min(1) }),
  batchRowSchema,
]);

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов пользователей (через fastify.repos)               */
/*  POST /batch-import создаёт подрядчиков локально (standalone auth):  */
/*  bcrypt-хэш в public.users, без Supabase.                           */
/* ------------------------------------------------------------------ */

async function userRoutes(fastify: FastifyInstance): Promise<void> {
  /** GET /api/users — список пользователей с контрагентами и объектами */
  fastify.get('/', { preHandler: [authenticate, requireRole('admin')] }, async (request) => {
    return request.server.repos.users.listWithDetails();
  });

  /** GET /api/users/:id/site-ids — объекты пользователя (allSites + siteIds) */
  fastify.get<{ Params: IdParams }>(
    '/:id/site-ids',
    { schema: idParamsSchema, preHandler: [authenticate] },
    async (request) => {
      return request.server.repos.users.getSiteAccess(request.params.id);
    },
  );

  /** GET /api/users/:id/construction-sites — маппинг объектов пользователя */
  fastify.get<{ Params: IdParams }>(
    '/:id/construction-sites',
    { schema: idParamsSchema, preHandler: [authenticate] },
    async (request) => {
      return request.server.repos.users.getSiteMappingIds(request.params.id);
    },
  );

  /** GET /api/users/:id — один пользователь */
  fastify.get<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      return request.server.repos.users.getWithDetails(request.params.id);
    },
  );

  /** PUT /api/users/:id — обновление пользователя (+ объекты, + авторезолв уведомлений) */
  fastify.put<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const b = updateUserWithSitesBodySchema.parse(request.body);
      await request.server.repos.users.updateWithSites(request.params.id, {
        fullName: b.full_name,
        role: b.role,
        counterpartyId: b.counterparty_id ?? null,
        department: b.department ?? null,
        allSites: b.all_sites,
        siteIds: b.site_ids,
      });
      return { success: true };
    },
  );

  /** DELETE /api/users/:id — деактивация пользователя */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      await request.server.repos.users.setActive(request.params.id, false);
      return { success: true };
    },
  );

  /** PATCH /api/users/:id — частичное обновление (активация и т.д.) */
  fastify.patch<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const body = patchBodySchema.parse(request.body ?? {});
      if (body.isActive !== undefined) {
        await request.server.repos.users.setActive(request.params.id, body.isActive);
      }
      return { success: true };
    },
  );

  /** PUT /api/users/:id/activate — активация пользователя */
  fastify.put<{ Params: IdParams }>(
    '/:id/activate',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      await request.server.repos.users.setActive(request.params.id, true);
      return { success: true };
    },
  );

  /** PUT /api/users/:id/sites — обновление привязки к объектам */
  fastify.put<{ Params: IdParams }>(
    '/:id/sites',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const { siteIds } = updateUserSitesBodySchema.parse(request.body);
      await request.server.repos.users.setSiteMappings(request.params.id, siteIds);
      return { success: true };
    },
  );

  /** POST /api/users/batch-import — создание пользователей-подрядчиков (standalone auth).
   *  Учётка и bcrypt-хэш пароля создаются локально в public.users; уникальность email
   *  гарантирует индекс users_email_lower_unique_idx (миграция 0005). */
  fastify.post(
    '/batch-import',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const parsed = batchImportBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Неверный формат данных' });
      }
      const rows = 'rows' in parsed.data ? parsed.data.rows : [parsed.data];
      const { authServices, repos } = request.server;
      const results: { email: string; status: 'success' | 'error'; errorMessage?: string }[] = [];

      for (const row of rows) {
        try {
          PasswordService.assertStrong(row.password);
          const id = randomUUID();
          const passwordHash = await authServices.passwords.hash(row.password);
          await repos.users.createCounterpartyUserRecord({
            id,
            email: row.email,
            fullName: row.fullName,
            counterpartyId: row.counterpartyId,
          });
          await authServices.users.setPasswordHash(id, passwordHash, new Date().toISOString());
          results.push({ email: row.email, status: 'success' });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
          // Регистронезависимый дубль email (индекс users_email_lower_unique_idx) → понятный текст.
          const errorMessage = /users_email_lower_unique_idx|duplicate key|unique/i.test(msg)
            ? `Пользователь с email ${row.email} уже существует`
            : msg;
          results.push({ email: row.email, status: 'error', errorMessage });
        }
      }

      return { results };
    },
  );
}

export default userRoutes;
