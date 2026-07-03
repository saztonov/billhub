/**
 * Standalone-маршруты аутентификации (AUTH_MODE=standalone, стандарт v3 раздел 13).
 * Регистрируются диспетчером routes/auth.ts. Используют fastify.authServices (плагин auth).
 *
 * Эндпоинты:
 *   GET  /api/auth/csrf                    — выдать CSRF-токен (double-submit).
 *   POST /api/auth/login                   — bcrypt-сравнение, выдача access+refresh.
 *   POST /api/auth/refresh                 — race-safe rotation.
 *   POST /api/auth/logout                  — ревокация family + очистка cookie.
 *   GET  /api/auth/me                      — текущий пользователь.
 *   POST /api/auth/password/change         — смена пароля (нужен старый).
 *   POST /api/auth/password/reset/request  — admin-only, copy-once plain-токен.
 *   POST /api/auth/password/reset/confirm  — подтверждение сброса.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { CookieSerializeOptions } from '@fastify/cookie';
import { config } from '../config.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { createRateLimiter, emailHmac, ipEmailKey } from '../middleware/rate-limit.js';

const isProduction = config.nodeEnv === 'production';

/* ------------------------------ Тела запросов ------------------------------ */

interface LoginBody {
  email: string;
  password: string;
}
interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}
interface ResetRequestBody {
  email: string;
}
interface ResetConfirmBody {
  token: string;
  newPassword: string;
}

/* ------------------------------- Cookie-хелперы ---------------------------- */

/** Путь refresh-cookie в standalone-режиме (обслуживает и /api/auth/refresh, и /api/auth/logout). */
const REFRESH_COOKIE_PATH = '/api/auth';

/**
 * Путь refresh-cookie в legacy-режиме (supabase-bridge, auth-legacy.ts клал её на /api/auth/refresh).
 * После cutover на standalone из-за разницы путей в браузере остаётся «осиротевшая» legacy-cookie:
 * при POST /api/auth/refresh браузер отправляет её первой (более длинный путь приоритетнее по RFC 6265),
 * сервер читает невалидный по формату токен и отвечает 401. Поэтому standalone обязан явно чистить
 * refresh_token и по этому пути — иначе пользователей выбрасывает при каждом обновлении токена.
 */
const LEGACY_REFRESH_COOKIE_PATH = '/api/auth/refresh';

function accessCookie(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: config.jwtAccessTtlSeconds,
  };
}

function refreshCookie(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: config.refreshTtlSeconds,
  };
}

/** Удаляет «осиротевшую» refresh-cookie legacy-пути (см. LEGACY_REFRESH_COOKIE_PATH). */
function clearLegacyRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie('refresh_token', { path: LEGACY_REFRESH_COOKIE_PATH });
}

function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie('access_token', { path: '/' });
  reply.clearCookie('refresh_token', { path: REFRESH_COOKIE_PATH });
  clearLegacyRefreshCookie(reply);
}

/* ------------------------------- JSON-схемы -------------------------------- */

const loginSchema = {
  body: {
    type: 'object' as const,
    required: ['email', 'password'],
    properties: {
      email: { type: 'string' as const, format: 'email' },
      password: { type: 'string' as const, minLength: 1 },
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
      newPassword: { type: 'string' as const, minLength: 8 },
    },
    additionalProperties: false,
  },
};

const resetRequestSchema = {
  body: {
    type: 'object' as const,
    required: ['email'],
    properties: { email: { type: 'string' as const, format: 'email' } },
    additionalProperties: false,
  },
};

const resetConfirmSchema = {
  body: {
    type: 'object' as const,
    required: ['token', 'newPassword'],
    properties: {
      token: { type: 'string' as const, minLength: 1 },
      newPassword: { type: 'string' as const, minLength: 8 },
    },
    additionalProperties: false,
  },
};

/* --------------------------------- Плагин ---------------------------------- */

async function standaloneAuthRoutes(fastify: FastifyInstance): Promise<void> {
  // Лимитеры создаются ОДИН раз на регистрацию — окна живут весь lifecycle приложения.
  const loginLimiter = createRateLimiter({
    max: 5,
    windowMs: '5m',
    key: ipEmailKey(config.auditHmacKey),
  });
  const resetLimiter = createRateLimiter({
    max: 3,
    windowMs: '1h',
    key: ipEmailKey(config.auditHmacKey),
  });

  /** GET /api/auth/csrf — выдаёт/возвращает CSRF-токен (cookie ставит csrf-плагин). */
  fastify.get('/api/auth/csrf', async (request) => {
    return { csrfToken: request.csrfToken ?? null };
  });

  /** POST /api/auth/login */
  fastify.post<{ Body: LoginBody }>(
    '/api/auth/login',
    { schema: loginSchema, preHandler: [loginLimiter] },
    async (request, reply) => {
      const { email, password } = request.body;
      const { authServices } = request.server;
      const ip = request.ip;

      const rec = await authServices.users.findByEmail(email);
      const ok = rec ? await authServices.passwords.compare(password, rec.passwordHash) : false;

      if (!rec || !ok) {
        authServices.audit.emit('login_failure', {
          emailHmac: emailHmac(email, config.auditHmacKey),
          ip,
        });
        return reply.status(401).send({ error: 'Неверный email или пароль' });
      }
      if (!rec.isActive) {
        return reply.status(403).send({ error: 'Учётная запись деактивирована' });
      }

      const access = await authServices.tokens.signAccess({
        sub: rec.id,
        role: rec.role,
        email: rec.email,
      });
      const refresh = await authServices.refresh.issueForLogin(rec.id, {
        ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      reply.setCookie('access_token', access.token, accessCookie());
      reply.setCookie('refresh_token', refresh.refreshToken, refreshCookie());
      // Лечим браузеры с «осиротевшей» legacy refresh-cookie: без этого при следующем /refresh
      // браузер снова отправит невалидный legacy-токен и пользователя выбросит через ~15 минут.
      // Порядок неважен для браузера (разные пути = разные cookie), но рабочий токен идёт первым.
      clearLegacyRefreshCookie(reply);

      authServices.audit.emit('login_success', {
        userId: rec.id,
        emailHmac: emailHmac(rec.email, config.auditHmacKey),
        ip,
      });

      return {
        user: {
          id: rec.id,
          email: rec.email,
          fullName: rec.fullName,
          role: rec.role,
          counterpartyId: rec.counterpartyId ?? undefined,
          department: rec.departmentId ?? undefined,
          allSites: rec.allSites,
          isActive: rec.isActive,
        },
        accessTokenExpiresAt: access.expiresAtMs,
      };
    },
  );

  /** POST /api/auth/refresh — race-safe rotation. */
  fastify.post('/api/auth/refresh', async (request, reply) => {
    const token = request.cookies['refresh_token'];
    if (!token) {
      return reply.status(401).send({ error: 'Refresh token отсутствует' });
    }
    const { authServices } = request.server;
    const result = await authServices.refresh.rotate(token, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    if (!result.ok) {
      clearAuthCookies(reply);
      const message =
        result.reason === 'reuse_detected'
          ? 'Сессия аннулирована из соображений безопасности'
          : 'Не удалось обновить сессию';
      return reply.status(401).send({ error: message });
    }

    const rec = await authServices.users.findById(result.userId);
    if (!rec || !rec.isActive) {
      clearAuthCookies(reply);
      return reply.status(401).send({ error: 'Не удалось обновить сессию' });
    }

    const access = await authServices.tokens.signAccess({
      sub: rec.id,
      role: rec.role,
      email: rec.email,
    });
    reply.setCookie('access_token', access.token, accessCookie());
    reply.setCookie('refresh_token', result.refreshToken, refreshCookie());

    return { success: true, accessTokenExpiresAt: access.expiresAtMs };
  });

  /** POST /api/auth/logout — ревокация family + очистка cookie. */
  fastify.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies['refresh_token'];
    if (token) {
      await request.server.authServices.refresh.revokeByToken(token);
    }
    clearAuthCookies(reply);
    request.server.authServices.audit.emit('logout', { ip: request.ip });
    return { success: true };
  });

  /** GET /api/auth/me */
  fastify.get('/api/auth/me', { preHandler: [authenticate] }, async (request) => {
    const exp = request.accessTokenExp;
    const accessTokenExpiresAt =
      typeof exp === 'number' ? exp * 1000 : Date.now() + config.jwtAccessTtlSeconds * 1000;
    return { user: request.user, accessTokenExpiresAt };
  });

  /** POST /api/auth/password/change — нужен старый пароль. */
  fastify.post<{ Body: ChangePasswordBody }>(
    '/api/auth/password/change',
    { schema: changePasswordSchema, preHandler: [authenticate] },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body;
      const user = request.user!;
      const { authServices } = request.server;

      const rec = await authServices.users.findById(user.id);
      const ok = rec
        ? await authServices.passwords.compare(currentPassword, rec.passwordHash)
        : false;
      if (!rec || !ok) {
        return reply.status(400).send({ error: 'Текущий пароль неверен' });
      }

      const newHash = await authServices.passwords.hash(newPassword);
      await authServices.users.setPasswordHash(user.id, newHash, new Date().toISOString());
      authServices.audit.emit('password_change', {
        userId: user.id,
        emailHmac: emailHmac(rec.email, config.auditHmacKey),
      });
      return { success: true };
    },
  );

  /** POST /api/auth/password/reset/request — admin-only, copy-once plain-токен. */
  fastify.post<{ Body: ResetRequestBody }>(
    '/api/auth/password/reset/request',
    {
      schema: resetRequestSchema,
      preHandler: [authenticate, requireRole('admin'), resetLimiter],
    },
    async (request, reply) => {
      const { email } = request.body;
      const { authServices } = request.server;

      const rec = await authServices.users.findByEmail(email);
      if (!rec) {
        return reply.status(404).send({ error: 'Пользователь не найден' });
      }

      const result = await authServices.passwordReset.request(rec.id);
      // Доставка через @su10/mail (заглушка пишет в свой JSON-лог, НЕ в audit_log).
      // Audit фиксирует ФАКТ доставки (kind + emailHmac), но НИКОГДА сам токен.
      const mailHmac = emailHmac(rec.email, config.auditHmacKey);
      try {
        await authServices.mail.sendPasswordReset(
          { id: rec.id, email: rec.email, fullName: rec.fullName },
          result.plainToken,
        );
        authServices.audit.emit('mail_sent', {
          userId: rec.id,
          emailHmac: mailHmac,
          mailKind: 'password_reset',
        });
      } catch (mailErr) {
        authServices.audit.emit('mail_failed', {
          userId: rec.id,
          emailHmac: mailHmac,
          mailKind: 'password_reset',
        });
        throw mailErr;
      }

      // plain-токен возвращается АДМИНУ один раз (copy-once UI). В audit_log его нет.
      return {
        resetToken: result.plainToken,
        tokenId: result.tokenId,
        expiresAt: new Date(result.expiresAtMs).toISOString(),
      };
    },
  );

  /** POST /api/auth/password/reset/confirm */
  fastify.post<{ Body: ResetConfirmBody }>(
    '/api/auth/password/reset/confirm',
    { schema: resetConfirmSchema },
    async (request, reply) => {
      const { token, newPassword } = request.body;
      const result = await request.server.authServices.passwordReset.confirm(token, newPassword);
      if (!result.ok) {
        const message =
          result.reason === 'expired'
            ? 'Срок действия токена истёк'
            : result.reason === 'used'
              ? 'Токен уже использован'
              : 'Токен недействителен';
        return reply.status(400).send({ error: message });
      }
      return { success: true };
    },
  );
}

export default standaloneAuthRoutes;
