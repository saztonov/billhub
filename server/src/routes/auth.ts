import type { FastifyInstance, FastifyReply } from 'fastify';
import type { CookieSerializeOptions } from '@fastify/cookie';
import { config } from '../config.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import type { RequestUser, UserRole } from '../types/index.js';

/* ------------------------------------------------------------------ */
/*  Типы тел запросов                                                  */
/* ------------------------------------------------------------------ */

interface LoginBody {
  email: string;
  password: string;
}

interface RegisterBody {
  email: string;
  password: string;
  fullName: string;
  token: string;
}

interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

interface CreateUserBody {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  counterpartyId?: string;
  departmentId?: string;
  allSites?: boolean;
  siteIds?: string[];
}

interface AdminChangePasswordBody {
  userId: string;
  newPassword: string;
}

/* ------------------------------------------------------------------ */
/*  Хелперы куки                                                       */
/* ------------------------------------------------------------------ */

const isProduction = config.nodeEnv === 'production';

/** Опции куки для access_token (15 минут) */
function accessTokenCookie(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: 900,
  };
}

/** Опции куки для refresh_token (7 дней) */
function refreshTokenCookie(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/api/auth/refresh',
    maxAge: 604_800,
  };
}

/** Очистка обеих кук */
function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie('access_token', { path: '/' });
  reply.clearCookie('refresh_token', { path: '/api/auth/refresh' });
}

/* ------------------------------------------------------------------ */
/*  Хелпер загрузки профиля пользователя                               */
/* ------------------------------------------------------------------ */

async function fetchUserProfile(
  fastify: FastifyInstance,
  userId: string
): Promise<RequestUser | null> {
  const { data, error } = await fastify.supabase
    .from('users')
    .select(
      'id, email, role, counterparty_id, department_id, all_sites, full_name, is_active'
    )
    .eq('id', userId)
    .single();

  if (error || !data) return null;

  return {
    id: data.id as string,
    email: data.email as string,
    fullName: data.full_name as string,
    role: data.role as UserRole,
    counterpartyId: (data.counterparty_id as string) || undefined,
    department: (data.department_id as string) || undefined,
    allSites: data.all_sites as boolean,
    isActive: data.is_active as boolean,
  };
}

/* ------------------------------------------------------------------ */
/*  JSON-схемы валидации                                               */
/* ------------------------------------------------------------------ */

const loginSchema = {
  body: {
    type: 'object' as const,
    required: ['email', 'password'],
    properties: {
      email: { type: 'string' as const, format: 'email' },
      password: { type: 'string' as const, minLength: 6 },
    },
    additionalProperties: false,
  },
};

const registerSchema = {
  body: {
    type: 'object' as const,
    required: ['email', 'password', 'fullName', 'token'],
    properties: {
      email: { type: 'string' as const, format: 'email' },
      password: { type: 'string' as const, minLength: 6 },
      fullName: { type: 'string' as const, minLength: 1 },
      token: { type: 'string' as const, minLength: 1 },
    },
    additionalProperties: false,
  },
};

const changePasswordSchema = {
  body: {
    type: 'object' as const,
    required: ['currentPassword', 'newPassword'],
    properties: {
      currentPassword: { type: 'string' as const, minLength: 1 },
      newPassword: { type: 'string' as const, minLength: 6 },
    },
    additionalProperties: false,
  },
};

const createUserSchema = {
  body: {
    type: 'object' as const,
    required: ['email', 'password', 'fullName', 'role'],
    properties: {
      email: { type: 'string' as const, format: 'email' },
      password: { type: 'string' as const, minLength: 6 },
      fullName: { type: 'string' as const, minLength: 1 },
      role: { type: 'string' as const, enum: ['admin', 'user', 'counterparty_user'] },
      counterpartyId: { type: 'string' as const },
      departmentId: { type: 'string' as const },
      allSites: { type: 'boolean' as const },
      siteIds: { type: 'array' as const, items: { type: 'string' as const } },
    },
    additionalProperties: false,
  },
};

const adminChangePasswordSchema = {
  body: {
    type: 'object' as const,
    required: ['userId', 'newPassword'],
    properties: {
      userId: { type: 'string' as const, minLength: 1 },
      newPassword: { type: 'string' as const, minLength: 6 },
    },
    additionalProperties: false,
  },
};

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов аутентификации                                    */
/* ------------------------------------------------------------------ */

async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /** POST /api/auth/login — вход по email/password */
  fastify.post<{ Body: LoginBody }>(
    '/api/auth/login',
    { schema: loginSchema },
    async (request, reply) => {
      const { email, password } = request.body;

      const { data: authData, error: authError } =
        await request.server.supabase.auth.signInWithPassword({ email, password });

      if (authError || !authData.session) {
        return reply.status(401).send({ error: 'Неверный email или пароль' });
      }

      const user = await fetchUserProfile(request.server, authData.user.id);

      if (!user) {
        return reply.status(401).send({ error: 'Профиль пользователя не найден' });
      }

      if (!user.isActive) {
        await request.server.supabase.auth.signOut();
        return reply.status(403).send({ error: 'Учётная запись деактивирована' });
      }

      reply.setCookie('access_token', authData.session.access_token, accessTokenCookie());
      reply.setCookie('refresh_token', authData.session.refresh_token, refreshTokenCookie());

      return {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          counterpartyId: user.counterpartyId,
          department: user.department,
          allSites: user.allSites,
          isActive: user.isActive,
        },
      };
    }
  );

  /** POST /api/auth/logout — выход, очистка кук */
  fastify.post('/api/auth/logout', async (_request, reply) => {
    clearAuthCookies(reply);
    return { success: true };
  });

  /** POST /api/auth/refresh — обновление токенов через refresh_token */
  fastify.post('/api/auth/refresh', async (request, reply) => {
    const refreshToken = request.cookies['refresh_token'];

    if (!refreshToken) {
      return reply.status(401).send({ error: 'Refresh token отсутствует' });
    }

    const { data, error } =
      await request.server.supabase.auth.refreshSession({ refresh_token: refreshToken });

    if (error || !data.session) {
      clearAuthCookies(reply);
      return reply.status(401).send({ error: 'Не удалось обновить сессию' });
    }

    reply.setCookie('access_token', data.session.access_token, accessTokenCookie());
    reply.setCookie('refresh_token', data.session.refresh_token, refreshTokenCookie());

    return { success: true };
  });

  /** GET /api/auth/me — текущий пользователь (требует аутентификации) */
  fastify.get(
    '/api/auth/me',
    { preHandler: [authenticate] },
    async (request) => {
      return { user: request.user };
    }
  );

  /** GET /api/auth/validate-token — проверка токена регистрации */
  fastify.get<{ Querystring: { token: string } }>(
    '/api/auth/validate-token',
    {
      schema: {
        querystring: {
          type: 'object' as const,
          required: ['token'],
          properties: {
            token: { type: 'string' as const, minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { token } = request.query;

      const { data, error } = await request.server.supabase
        .from('counterparties')
        .select('id, name')
        .eq('registration_token', token)
        .single();

      if (error || !data) {
        return reply.status(400).send({ valid: false, counterpartyName: '' });
      }

      return { valid: true, counterpartyName: data.name };
    }
  );

  /** POST /api/auth/register — регистрация по токену контрагента */
  fastify.post<{ Body: RegisterBody }>(
    '/api/auth/register',
    { schema: registerSchema },
    async (request, reply) => {
      const { email, password, fullName, token } = request.body;

      /** Валидация токена регистрации */
      const { data: counterparty, error: tokenError } = await request.server.supabase
        .from('counterparties')
        .select('id, name')
        .eq('registration_token', token)
        .single();

      if (tokenError || !counterparty) {
        return reply.status(400).send({ error: 'Недействительный токен регистрации' });
      }

      /** Создание пользователя в Supabase Auth */
      const { data: authData, error: authError } =
        await request.server.supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });

      if (authError || !authData.user) {
        return reply.status(400).send({
          error: authError?.message ?? 'Не удалось создать пользователя',
        });
      }

      /** Создание записи в таблице users */
      const { error: insertError } = await request.server.supabase
        .from('users')
        .insert({
          id: authData.user.id,
          email,
          full_name: fullName,
          role: 'counterparty_user',
          counterparty_id: counterparty.id,
        });

      if (insertError) {
        /** Откат — удаляем пользователя из Auth */
        await request.server.supabase.auth.admin.deleteUser(authData.user.id);
        return reply.status(500).send({ error: 'Ошибка создания профиля пользователя' });
      }

      return { success: true };
    }
  );

  /** POST /api/auth/change-password — смена собственного пароля */
  fastify.post<{ Body: ChangePasswordBody }>(
    '/api/auth/change-password',
    { schema: changePasswordSchema, preHandler: [authenticate] },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body;
      const user = request.user!;

      /** Проверяем текущий пароль */
      const { error: verifyError } =
        await request.server.supabase.auth.signInWithPassword({
          email: user.email,
          password: currentPassword,
        });

      if (verifyError) {
        return reply.status(400).send({ error: 'Текущий пароль неверен' });
      }

      /** Обновляем пароль через admin API */
      const { error: updateError } =
        await request.server.supabase.auth.admin.updateUserById(user.id, {
          password: newPassword,
        });

      if (updateError) {
        return reply.status(500).send({ error: 'Не удалось обновить пароль' });
      }

      return { success: true };
    }
  );

  /** POST /api/auth/create-user — создание пользователя администратором */
  fastify.post<{ Body: CreateUserBody }>(
    '/api/auth/create-user',
    { schema: createUserSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { email, password, fullName, role, counterpartyId, departmentId, allSites, siteIds } =
        request.body;

      /** Создание пользователя в Supabase Auth */
      const { data: authData, error: authError } =
        await request.server.supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });

      if (authError || !authData.user) {
        return reply.status(400).send({
          error: authError?.message ?? 'Не удалось создать пользователя',
        });
      }

      /** Создание записи в таблице users */
      const { error: insertError } = await request.server.supabase
        .from('users')
        .insert({
          id: authData.user.id,
          email,
          full_name: fullName,
          role,
          counterparty_id: counterpartyId ?? null,
          department_id: departmentId ?? null,
          all_sites: allSites ?? false,
        });

      if (insertError) {
        await request.server.supabase.auth.admin.deleteUser(authData.user.id);
        return reply.status(500).send({ error: 'Ошибка создания профиля пользователя' });
      }

      /** Привязка к объектам строительства */
      if (siteIds && siteIds.length > 0) {
        const mappings = siteIds.map((siteId) => ({
          user_id: authData.user.id,
          construction_site_id: siteId,
        }));

        const { error: mappingError } = await request.server.supabase
          .from('user_construction_sites_mapping')
          .insert(mappings);

        if (mappingError) {
          request.log.error(
            { error: mappingError },
            'Ошибка привязки пользователя к объектам'
          );
        }
      }

      return {
        user: {
          id: authData.user.id,
          email,
          fullName,
          role,
        },
      };
    }
  );

  /** POST /api/auth/admin-change-password — смена пароля пользователя администратором */
  fastify.post<{ Body: AdminChangePasswordBody }>(
    '/api/auth/admin-change-password',
    { schema: adminChangePasswordSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { userId, newPassword } = request.body;

      const { error } = await request.server.supabase.rpc('change_user_password', {
        target_user_id: userId,
        new_password: newPassword,
      });

      if (error) {
        return reply.status(500).send({ error: 'Не удалось изменить пароль' });
      }

      return { success: true };
    }
  );
}

export default authRoutes;
