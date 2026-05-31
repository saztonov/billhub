/**
 * Диспетчер маршрутов аутентификации (Iteration 6).
 *
 * По AUTH_MODE регистрирует один из двух наборов:
 *   standalone      → routes/auth-standalone.ts (стандарт v3 раздел 13).
 *   supabase-bridge → routes/auth-legacy.ts (legacy Supabase Auth, поведение не изменено).
 *
 * AUTH_MODE — обычный feature-флаг (НЕ startup-инвариант). Сервисы и хранилища wired-ятся
 * плагином plugins/auth.ts; CSRF — plugins/csrf.ts (активна только в standalone).
 */
import type { FastifyInstance } from 'fastify';
import { resolveAuthMode } from '../plugins/auth.js';
import legacyAuthRoutes from './auth-legacy.js';
import standaloneAuthRoutes from './auth-standalone.js';

async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const mode = resolveAuthMode(process.env);
  if (mode === 'standalone') {
    await fastify.register(standaloneAuthRoutes);
  } else {
    await fastify.register(legacyAuthRoutes);
  }
}

export default authRoutes;
