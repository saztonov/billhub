/**
 * Диспетчер маршрутов аутентификации.
 *
 * По AUTH_MODE регистрирует один из наборов:
 *   standalone      → routes/auth-standalone.ts (bcrypt + access JWT + refresh rotation).
 *   keycloak        → routes/auth-keycloak.ts (OIDC Authorization Code + PKCE, BFF).
 *   supabase-bridge → routes/auth-legacy.ts (legacy Supabase Auth, поведение не изменено).
 *
 * AUTH_MODE — обычный feature-флаг (НЕ startup-инвариант). Сервисы и хранилища wired-ятся
 * плагином plugins/auth.ts; CSRF — plugins/csrf.ts (активна в standalone и keycloak).
 */
import type { FastifyInstance } from 'fastify';
import { resolveAuthMode } from '../plugins/auth.js';
import legacyAuthRoutes from './auth-legacy.js';
import standaloneAuthRoutes from './auth-standalone.js';
import keycloakAuthRoutes from './auth-keycloak.js';

async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const mode = resolveAuthMode(process.env);
  if (mode === 'standalone') {
    await fastify.register(standaloneAuthRoutes);
  } else if (mode === 'keycloak') {
    await fastify.register(keycloakAuthRoutes);
  } else {
    await fastify.register(legacyAuthRoutes);
  }
}

export default authRoutes;
