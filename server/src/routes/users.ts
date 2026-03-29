import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import type { UserRole } from '../types/index.js';

/* ------------------------------------------------------------------ */
/*  Типы тел запросов                                                  */
/* ------------------------------------------------------------------ */

interface IdParams {
  id: string;
}

interface UpdateUserBody {
  fullName: string;
  role: UserRole;
  counterpartyId: string | null;
  department: string | null;
  allSites: boolean;
  siteIds: string[];
}

interface UpdateSitesBody {
  siteIds: string[];
}

interface BatchImportRow {
  counterpartyId: string;
  email: string;
  password: string;
  fullName: string;
}

interface BatchImportBody {
  rows: BatchImportRow[];
}

/* ------------------------------------------------------------------ */
/*  JSON-схемы валидации                                               */
/* ------------------------------------------------------------------ */

const idParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'],
    properties: { id: { type: 'string' as const, minLength: 1 } },
  },
};

const updateUserSchema = {
  body: {
    type: 'object' as const,
    required: ['fullName', 'role', 'allSites', 'siteIds'],
    properties: {
      fullName: { type: 'string' as const, minLength: 1 },
      role: { type: 'string' as const, enum: ['admin', 'user', 'counterparty_user'] },
      counterpartyId: { type: ['string', 'null'] as const },
      department: { type: ['string', 'null'] as const },
      allSites: { type: 'boolean' as const },
      siteIds: { type: 'array' as const, items: { type: 'string' as const } },
    },
    additionalProperties: false,
  },
};

const updateSitesSchema = {
  body: {
    type: 'object' as const,
    required: ['siteIds'],
    properties: {
      siteIds: { type: 'array' as const, items: { type: 'string' as const } },
    },
    additionalProperties: false,
  },
};

const batchImportSchema = {
  body: {
    type: 'object' as const,
    required: ['rows'],
    properties: {
      rows: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          required: ['counterpartyId', 'email', 'password', 'fullName'],
          properties: {
            counterpartyId: { type: 'string' as const, minLength: 1 },
            email: { type: 'string' as const, format: 'email' },
            password: { type: 'string' as const, minLength: 6 },
            fullName: { type: 'string' as const, minLength: 1 },
          },
          additionalProperties: false,
        },
        minItems: 1,
      },
    },
    additionalProperties: false,
  },
};

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов пользователей                                     */
/* ------------------------------------------------------------------ */

async function userRoutes(fastify: FastifyInstance): Promise<void> {
  const USER_SELECT = 'id, email, full_name, role, counterparty_id, created_at, counterparties!counterparty_id(name), department_id, all_sites, is_active';
  const SITE_MAPPING_SELECT = 'user_id, construction_site_id, construction_sites(name)';

  /** GET /api/users — список пользователей с контрагентами и объектами */
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { data, error } = await request.server.supabase
        .from('users')
        .select(USER_SELECT)
        .order('created_at', { ascending: false });
      if (error) return reply.status(500).send({ error: error.message });

      // Загружаем маппинг пользователей к объектам
      const { data: siteMappings, error: smError } = await request.server.supabase
        .from('user_construction_sites_mapping')
        .select(SITE_MAPPING_SELECT);
      if (smError) return reply.status(500).send({ error: smError.message });

      // Группируем маппинги по user_id
      const sitesByUser = new Map<string, { ids: string[]; names: string[] }>();
      for (const mapping of siteMappings ?? []) {
        const row = mapping as Record<string, unknown>;
        const userId = row.user_id as string;
        const siteId = row.construction_site_id as string;
        const siteName = (row.construction_sites as Record<string, unknown> | null)?.name as string ?? '';
        if (!sitesByUser.has(userId)) {
          sitesByUser.set(userId, { ids: [], names: [] });
        }
        const entry = sitesByUser.get(userId)!;
        entry.ids.push(siteId);
        entry.names.push(siteName);
      }

      // Формируем ответ
      const users = (data ?? []).map((row: Record<string, unknown>) => {
        const userId = row.id as string;
        const sites = sitesByUser.get(userId);
        return {
          id: userId,
          email: row.email,
          fullName: row.full_name,
          role: row.role,
          counterpartyId: row.counterparty_id,
          counterpartyName: (row.counterparties as Record<string, unknown> | null)?.name ?? null,
          department: row.department_id,
          allSites: row.all_sites ?? false,
          isActive: row.is_active ?? true,
          siteIds: sites?.ids ?? [],
          siteNames: sites?.names ?? [],
          createdAt: row.created_at,
        };
      });

      return users;
    }
  );

  /** GET /api/users/:id — один пользователь */
  fastify.get<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { data, error } = await request.server.supabase
        .from('users')
        .select(USER_SELECT)
        .eq('id', id)
        .single();
      if (error) return reply.status(404).send({ error: 'Пользователь не найден' });

      // Загружаем объекты пользователя
      const { data: siteMappings } = await request.server.supabase
        .from('user_construction_sites_mapping')
        .select(SITE_MAPPING_SELECT)
        .eq('user_id', id);

      const siteIds: string[] = [];
      const siteNames: string[] = [];
      for (const mapping of siteMappings ?? []) {
        const row = mapping as Record<string, unknown>;
        siteIds.push(row.construction_site_id as string);
        siteNames.push((row.construction_sites as Record<string, unknown> | null)?.name as string ?? '');
      }

      const row = data as Record<string, unknown>;
      return {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        role: row.role,
        counterpartyId: row.counterparty_id,
        counterpartyName: (row.counterparties as Record<string, unknown> | null)?.name ?? null,
        department: row.department_id,
        allSites: row.all_sites ?? false,
        isActive: row.is_active ?? true,
        siteIds,
        siteNames,
        createdAt: row.created_at,
      };
    }
  );

  /** PUT /api/users/:id — обновление пользователя */
  fastify.put<{ Params: IdParams; Body: UpdateUserBody }>(
    '/:id',
    { schema: { ...idParamsSchema, ...updateUserSchema }, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { fullName, role, counterpartyId, department, allSites, siteIds } = request.body;

      // Валидация: для подразделения Штаб обязательно 1-2 объекта
      if (department === 'shtab' && !allSites) {
        if (siteIds.length === 0) {
          return reply.status(400).send({ error: 'Для подразделения Штаб необходимо выбрать хотя бы один объект' });
        }
        if (siteIds.length > 2) {
          return reply.status(400).send({ error: 'Для подразделения Штаб можно выбрать не более 2 объектов' });
        }
      }

      // Обновляем основные поля
      const { error } = await request.server.supabase
        .from('users')
        .update({
          full_name: fullName,
          role,
          counterparty_id: role === 'counterparty_user' ? counterpartyId : null,
          department_id: role !== 'counterparty_user' ? department : null,
          all_sites: role === 'counterparty_user' ? false : allSites,
        })
        .eq('id', id);
      if (error) return reply.status(400).send({ error: error.message });

      // Обновляем маппинг объектов: удаляем старые
      const { error: delError } = await request.server.supabase
        .from('user_construction_sites_mapping')
        .delete()
        .eq('user_id', id);
      if (delError) return reply.status(500).send({ error: delError.message });

      // Вставляем новые (только если не all_sites и не counterparty_user)
      if (!allSites && role !== 'counterparty_user' && siteIds.length > 0) {
        const rows = siteIds.map((siteId) => ({ user_id: id, construction_site_id: siteId }));
        const { error: insError } = await request.server.supabase
          .from('user_construction_sites_mapping')
          .insert(rows);
        if (insError) return reply.status(500).send({ error: insError.message });
      }

      // Авторезолв уведомлений missing_specialist
      if (department && role !== 'counterparty_user') {
        const { data: unresolvedNotifs } = await request.server.supabase
          .from('notifications')
          .select('id, department_id, site_id')
          .eq('type', 'missing_specialist')
          .eq('resolved', false)
          .eq('department_id', department);

        for (const notif of unresolvedNotifs ?? []) {
          const nr = notif as Record<string, unknown>;
          const notifSiteId = nr.site_id as string | null;
          const matchesSite = allSites || (notifSiteId && siteIds.includes(notifSiteId));
          if (matchesSite) {
            await request.server.supabase
              .from('notifications')
              .update({ resolved: true, resolved_at: new Date().toISOString() })
              .eq('department_id', nr.department_id as string)
              .eq('site_id', notifSiteId)
              .eq('type', 'missing_specialist')
              .eq('resolved', false);
          }
        }
      }

      return { success: true };
    }
  );

  /** DELETE /api/users/:id — деактивация пользователя */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { error } = await request.server.supabase
        .from('users')
        .update({ is_active: false })
        .eq('id', id);
      if (error) return reply.status(400).send({ error: error.message });
      return { success: true };
    }
  );

  /** PUT /api/users/:id/activate — активация пользователя */
  fastify.put<{ Params: IdParams }>(
    '/:id/activate',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { error } = await request.server.supabase
        .from('users')
        .update({ is_active: true })
        .eq('id', id);
      if (error) return reply.status(400).send({ error: error.message });
      return { success: true };
    }
  );

  /** PUT /api/users/:id/sites — обновление привязки к объектам */
  fastify.put<{ Params: IdParams; Body: UpdateSitesBody }>(
    '/:id/sites',
    { schema: { ...idParamsSchema, ...updateSitesSchema }, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { siteIds } = request.body;

      // Удаляем старые маппинги
      const { error: delError } = await request.server.supabase
        .from('user_construction_sites_mapping')
        .delete()
        .eq('user_id', id);
      if (delError) return reply.status(500).send({ error: delError.message });

      // Вставляем новые
      if (siteIds.length > 0) {
        const rows = siteIds.map((siteId) => ({ user_id: id, construction_site_id: siteId }));
        const { error: insError } = await request.server.supabase
          .from('user_construction_sites_mapping')
          .insert(rows);
        if (insError) return reply.status(500).send({ error: insError.message });
      }

      return { success: true };
    }
  );

  /** POST /api/users/batch-import — пакетное создание пользователей контрагентов */
  fastify.post<{ Body: BatchImportBody }>(
    '/batch-import',
    { schema: batchImportSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, _reply) => {
      const { rows } = request.body;
      const results: { email: string; status: 'success' | 'error'; errorMessage?: string }[] = [];

      for (const row of rows) {
        try {
          // Создаём пользователя в Auth
          const { data: authData, error: authError } =
            await request.server.supabase.auth.admin.createUser({
              email: row.email,
              password: row.password,
              email_confirm: true,
            });
          if (authError || !authData.user) {
            throw new Error(authError?.message ?? 'Не удалось создать пользователя в Auth');
          }

          // Вставляем запись в таблицу users
          const { error: insertError } = await request.server.supabase
            .from('users')
            .insert({
              id: authData.user.id,
              email: row.email,
              full_name: row.fullName,
              role: 'counterparty_user' as const,
              counterparty_id: row.counterpartyId,
              all_sites: false,
            });
          if (insertError) throw new Error(insertError.message);

          results.push({ email: row.email, status: 'success' });
        } catch (err) {
          results.push({
            email: row.email,
            status: 'error',
            errorMessage: err instanceof Error ? err.message : 'Неизвестная ошибка',
          });
        }
      }

      return { results };
    }
  );
}

export default userRoutes;
