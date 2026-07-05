import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { authenticate, invalidateUserCache } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { PasswordService } from '../services/auth/password.service.js';
import { keycloakAdminClient } from '../services/auth/keycloak/admin-client.js';
import { provisionPortalUser } from '../services/auth/keycloak/provisioning.js';
import {
  updateUserWithSitesBodySchema,
  updateUserSitesBodySchema,
  type CreateUserBody,
} from '../schemas/user.js';

/**
 * В keycloak-режиме активность доступа к порталу — членство в группе billhub-active. При
 * активации/деактивации из BillHub двигаем группу через Admin API (subject берём из
 * user_identity_links). Если связи ещё нет (пользователь не логинился) — no-op: группа
 * выставится в callback при первом входе.
 */
async function syncPortalGroup(
  request: FastifyRequest,
  userId: string,
  active: boolean,
): Promise<void> {
  if (request.server.authMode !== 'keycloak') return;
  const subject = await request.server.authServices.identityLinks.findSubjectByUserId(
    config.authIdentityProvider,
    userId,
  );
  if (!subject) return;
  try {
    await keycloakAdminClient.setPortalActive(subject, active);
  } catch (err) {
    request.log.error(
      { err, userId },
      'setPortalActive: не удалось синхронизировать группу Keycloak',
    );
  }
}

/**
 * admin-create в keycloak-режиме (Ф2): провижинит KC-идентичность СРАЗУ (иначе при закрытой
 * регистрации пользователь никогда не войдёт). Порядок: pre-generate id → KC (createUser +
 * billhub_user_id + billhub-pending) → локальный users (inactive, id=userId) → link. При сбое
 * локальной записи — компенсация (удаляем KC-юзера). Пароль обязателен (проверен выше).
 */
async function createUserKeycloak(
  request: FastifyRequest,
  b: z.infer<typeof createUserRequestSchema>,
): Promise<{ id: string; success: true }> {
  const userId = randomUUID();
  const sub = await provisionPortalUser(keycloakAdminClient, {
    userId,
    email: b.email,
    fullName: b.fullName,
    password: b.password!,
  });
  try {
    const user = await request.server.repos.users.create(
      {
        email: b.email,
        password: '',
        fullName: b.fullName,
        role: b.role,
        counterpartyId: b.counterpartyId ?? null,
        department: (b.departmentId ?? undefined) as CreateUserBody['department'],
        allSites: b.allSites ?? false,
        isActive: false,
      },
      userId,
    );
    if (b.siteIds && b.siteIds.length > 0) {
      await request.server.repos.users.setSiteMappings(user.id, b.siteIds);
    }
    await request.server.authServices.identityLinks.link({
      userId,
      provider: config.authIdentityProvider,
      subject: sub,
      emailAtLink: b.email,
    });
    return { id: user.id, success: true };
  } catch (err) {
    try {
      await keycloakAdminClient.deleteUser(sub);
    } catch (delErr) {
      request.log.error({ err: delErr }, 'admin-create: компенсация KC не удалась');
    }
    throw err;
  }
}

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

/** Тело канонического admin-create (POST /api/users). Соответствует payload фронта. */
const createUserRequestSchema = z.object({
  email: z.string().min(1),
  password: z.string().optional(),
  fullName: z.string().min(1),
  role: z.enum(['admin', 'user', 'counterparty_user', 'security']),
  counterpartyId: z.string().nullish(),
  departmentId: z.string().nullish(),
  allSites: z.boolean().optional(),
  siteIds: z.array(z.string()).optional(),
});

async function userRoutes(fastify: FastifyInstance): Promise<void> {
  /** GET /api/users — список пользователей с контрагентами и объектами */
  fastify.get('/', { preHandler: [authenticate, requireRole('admin')] }, async (request) => {
    return request.server.repos.users.listWithDetails();
  });

  /**
   * POST /api/users — канонический admin-create (заменяет legacy /api/auth/create-user).
   * Пользователь создаётся неактивным (см. решение v4). В standalone — с bcrypt-паролем;
   * в keycloak — без пароля (идентичность/пароль в Keycloak, связь по email при первом входе,
   * группа billhub-active — при активации).
   */
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const parsed = createUserRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Неверный формат данных' });
      }
      const b = parsed.data;
      const mode = request.server.authMode;
      // В standalone и keycloak пароль обязателен (keycloak: SMTP нет → админ задаёт пароль сразу).
      if (mode === 'standalone' || mode === 'keycloak') {
        if (!b.password) return reply.status(400).send({ error: 'Пароль обязателен' });
        PasswordService.assertStrong(b.password);
      }
      try {
        if (mode === 'keycloak') {
          return await createUserKeycloak(request, b);
        }
        const user = await request.server.repos.users.create({
          email: b.email,
          // password не персистится методом create (хэш ставится отдельно); поле нужно для типа.
          password: b.password ?? '',
          fullName: b.fullName,
          role: b.role,
          counterpartyId: b.counterpartyId ?? null,
          department: (b.departmentId ?? undefined) as CreateUserBody['department'],
          allSites: b.allSites ?? false,
          isActive: false,
        });
        if (b.siteIds && b.siteIds.length > 0) {
          await request.server.repos.users.setSiteMappings(user.id, b.siteIds);
        }
        if (mode === 'standalone' && b.password) {
          const hash = await request.server.authServices.passwords.hash(b.password);
          await request.server.authServices.users.setPasswordHash(
            user.id,
            hash,
            new Date().toISOString(),
          );
        }
        return { id: user.id, success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Ошибка создания пользователя';
        const errorMessage = /unique|duplicate|users_email_lower_unique_idx/i.test(msg)
          ? `Пользователь с email ${b.email} уже существует`
          : msg;
        return reply.status(400).send({ error: errorMessage });
      }
    },
  );

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
      invalidateUserCache(request.params.id);
      return { success: true };
    },
  );

  /** DELETE /api/users/:id — деактивация пользователя */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      await request.server.repos.users.setActive(request.params.id, false);
      await syncPortalGroup(request, request.params.id, false);
      invalidateUserCache(request.params.id);
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
        await syncPortalGroup(request, request.params.id, body.isActive);
        invalidateUserCache(request.params.id);
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
      await syncPortalGroup(request, request.params.id, true);
      invalidateUserCache(request.params.id);
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
