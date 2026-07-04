/**
 * Плагин аутентификации (Iteration 6). Резолвит AUTH_MODE, собирает сервисы standalone-auth
 * и декорирует fastify.authServices / fastify.authMode.
 *
 * AUTH_MODE — ОБЫЧНЫЙ feature-флаг, НЕ startup-инвариант (в отличие от DB_PROVIDER).
 *   supabase-bridge — legacy-путь (Supabase Auth).
 *   standalone      — собственный стек (bcrypt + access JWT + refresh rotation, раздел 13).
 *
 * Бэкенд хранилищ выбирается по наличию fastify.db (Drizzle): есть → DrizzleStore (production),
 * нет → in-memory (герметичные unit/inject-тесты без Docker).
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import {
  buildAuthServices,
  createPinoAuditLogger,
  type AuthServiceBundle,
  type AuditLogger,
} from '../services/auth/index.js';
import { AuditLogService } from '../services/auth/audit-log.service.js';
import { DrizzleAuditLogRepository } from '../repositories/drizzle/audit-log.drizzle.js';
import {
  InMemoryIdentityLinkStore,
  InMemoryPasswordResetStore,
  InMemoryRefreshTokenStore,
  InMemoryUserAuthStore,
} from '../services/auth/stores/memory.js';
import {
  DrizzleIdentityLinkStore,
  DrizzlePasswordResetStore,
  DrizzleRefreshTokenStore,
  DrizzleUserAuthStore,
} from '../services/auth/stores/pg.js';
import type { AuthStores } from '../services/auth/stores/types.js';
import { MailStub, DEFAULT_MAIL_STUB_LOG } from '../services/mail/mail-stub.js';

export type AuthMode = 'supabase-bridge' | 'standalone' | 'keycloak';

/** Резолюция AUTH_MODE из env (валидация значения; НЕ startup-инвариант). */
export function resolveAuthMode(env: NodeJS.ProcessEnv): AuthMode {
  const mode = (env.AUTH_MODE ?? 'supabase-bridge') as AuthMode;
  if (mode !== 'supabase-bridge' && mode !== 'standalone' && mode !== 'keycloak') {
    throw new Error(
      `Недопустимое значение AUTH_MODE=${mode}. Ожидается "supabase-bridge", "standalone" или "keycloak".`,
    );
  }
  return mode;
}

declare module 'fastify' {
  interface FastifyInstance {
    authMode: AuthMode;
    authServices: AuthServiceBundle;
  }
}

async function authPlugin(fastify: FastifyInstance): Promise<void> {
  const mode = resolveAuthMode(process.env);

  // Минимальная production-проверка секретов (полные startup checks — Iteration 7).
  if (
    mode === 'standalone' &&
    config.nodeEnv === 'production' &&
    config.authJwtSecret.startsWith('dev-insecure')
  ) {
    throw new Error(
      'AUTH_MODE=standalone в production требует заданный AUTH_JWT_SECRET (не dev-placeholder).',
    );
  }
  // keycloak в production: CSRF активен, audit используется, AUTH_JWT_SECRET нужен для отката —
  // ни один из этих секретов не должен оставаться dev-заглушкой.
  if (mode === 'keycloak' && config.nodeEnv === 'production') {
    const devSecrets = (
      [
        ['CSRF_SECRET', config.csrfSecret],
        ['AUDIT_HMAC_KEY', config.auditHmacKey],
        ['AUTH_JWT_SECRET', config.authJwtSecret],
      ] as const
    )
      .filter(([, value]) => value.startsWith('dev-insecure'))
      .map(([key]) => key);
    if (devSecrets.length > 0) {
      throw new Error(
        `AUTH_MODE=keycloak в production требует заданные секреты (не dev-placeholder): ${devSecrets.join(', ')}.`,
      );
    }
  }

  const stores: AuthStores = fastify.db
    ? {
        users: new DrizzleUserAuthStore(fastify.db),
        refreshTokens: new DrizzleRefreshTokenStore(fastify.db),
        passwordResets: new DrizzlePasswordResetStore(fastify.db),
        identityLinks: new DrizzleIdentityLinkStore(fastify.db),
      }
    : {
        users: new InMemoryUserAuthStore(),
        refreshTokens: new InMemoryRefreshTokenStore(),
        passwordResets: new InMemoryPasswordResetStore(),
        identityLinks: new InMemoryIdentityLinkStore(),
      };

  // Iteration 7: при наличии Drizzle (production standalone) security-события пишутся в audit_log
  // (+ pino-зеркало). Без fastify.db (герметичные тесты) — pino-only логгер Iteration 6.
  const audit: AuditLogger = fastify.db
    ? new AuditLogService({
        repo: new DrizzleAuditLogRepository(fastify.db),
        sink: fastify.log,
        hmacKey: config.auditHmacKey,
        onError: (err) => fastify.log.error({ err }, 'audit_log запись не удалась'),
      })
    : createPinoAuditLogger(fastify.log);
  const mail = new MailStub(process.env.MAIL_STUB_LOG_PATH ?? DEFAULT_MAIL_STUB_LOG);

  const services = buildAuthServices({
    stores,
    audit,
    mail,
    config: {
      authJwtSecret: config.authJwtSecret,
      jwtIssuer: config.jwtIssuer,
      jwtAudience: config.jwtAudience,
      jwtAccessTtlSeconds: config.jwtAccessTtlSeconds,
      refreshTtlSeconds: config.refreshTtlSeconds,
      refreshGraceMs: config.refreshGraceMs,
    },
  });

  fastify.decorate('authMode', mode);
  fastify.decorate('authServices', services);
  fastify.log.info(
    { authMode: mode, authStores: fastify.db ? 'drizzle' : 'memory' },
    'Auth services registered',
  );
}

export default fp(authPlugin, { name: 'auth' });
