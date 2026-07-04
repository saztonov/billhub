/**
 * CSRF-защита double-submit cookie (план Iteration 6, раздел 13).
 *
 * Активна ТОЛЬКО при AUTH_MODE=standalone (в supabase-bridge — no-op, чтобы не менять
 * поведение legacy-окружения и существующих тестов).
 *
 * Механика:
 *   - safe-методы (GET/HEAD/OPTIONS): если cookie csrf_token отсутствует — выдаём её
 *     (httpOnly=false, SameSite=Lax) и прокидываем токен в request.csrfToken.
 *   - write-методы (POST/PUT/PATCH/DELETE): требуем заголовок X-CSRF-Token, равный cookie
 *     csrf_token; иначе 403. Это double-submit: злоумышленник с другого origin не может
 *     прочитать cookie, чтобы продублировать её в заголовок.
 */
import fp from 'fastify-plugin';
import { randomBytes } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { resolveAuthMode } from './auth.js';

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

declare module 'fastify' {
  interface FastifyRequest {
    /** Текущий CSRF-токен сессии (для отдачи через GET /api/auth/csrf). */
    csrfToken?: string;
  }
}

function csrfCookieOptions(): CookieSerializeOptions {
  return {
    httpOnly: false, // double-submit требует читаемости из JS
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

async function csrfPlugin(fastify: FastifyInstance): Promise<void> {
  const mode = resolveAuthMode(process.env);
  // Активна в standalone и keycloak (write-запросы через double-submit). No-op только в
  // legacy supabase-bridge — не менять поведение старого окружения и тестов.
  if (mode !== 'standalone' && mode !== 'keycloak') {
    fastify.log.info('csrf: AUTH_MODE=supabase-bridge — CSRF неактивен (no-op)');
    return;
  }

  fastify.addHook('onRequest', async (request, reply) => {
    const method = request.method.toUpperCase();
    const existing = request.cookies[CSRF_COOKIE];

    if (SAFE_METHODS.has(method)) {
      let token = existing;
      if (!token) {
        token = randomBytes(32).toString('base64url');
        reply.setCookie(CSRF_COOKIE, token, csrfCookieOptions());
      }
      request.csrfToken = token;
      return;
    }

    // write-метод — валидация double-submit
    const raw = request.headers[CSRF_HEADER];
    const headerToken = Array.isArray(raw) ? raw[0] : raw;
    if (!existing || !headerToken || headerToken !== existing) {
      reply.status(403).send({ error: 'CSRF-токен отсутствует или недействителен' });
      return reply;
    }
    request.csrfToken = existing;
  });

  fastify.log.info({ authMode: mode }, 'csrf: double-submit cookie активна');
}

export default fp(csrfPlugin, { name: 'csrf' });
