/**
 * Сборка сервисов standalone-auth (Iteration 6). Фабрика buildAuthServices wired-ит
 * PasswordService / TokenService / RefreshTokenService / PasswordResetService поверх
 * переданных хранилищ (in-memory в тестах, Drizzle в production) и общих audit/mail.
 */
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { PasswordResetService } from './password-reset.service.js';
import type { AuditLogger } from './audit.js';
import type { AuthStores, UserAuthStore } from './stores/types.js';
import type { MailPort } from '../mail/mail-port.js';

export * from './password.service.js';
export * from './token.service.js';
export * from './refresh-token.service.js';
export * from './password-reset.service.js';
export * from './audit.js';
export * from './audit-log.service.js';
export type {
  AuthStores,
  UserAuthStore,
  UserAuthRecord,
  RefreshTokenStore,
  PasswordResetStore,
} from './stores/types.js';

/** Конфигурация криптопараметров auth. */
export interface AuthServicesConfig {
  authJwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtAccessTtlSeconds: number;
  refreshTtlSeconds: number;
  refreshGraceMs: number;
  passwordResetTtlSeconds?: number;
  bcryptCost?: number;
}

export interface BuildAuthServicesOptions {
  stores: AuthStores;
  audit: AuditLogger;
  mail: MailPort;
  config: AuthServicesConfig;
  now?: () => number;
}

/** Готовый набор сервисов аутентификации. */
export interface AuthServiceBundle {
  passwords: PasswordService;
  tokens: TokenService;
  refresh: RefreshTokenService;
  passwordReset: PasswordResetService;
  users: UserAuthStore;
  audit: AuditLogger;
  mail: MailPort;
}

export function buildAuthServices(opts: BuildAuthServicesOptions): AuthServiceBundle {
  const { stores, audit, mail, config, now } = opts;
  const passwords = new PasswordService(config.bcryptCost ?? 12);
  const tokens = new TokenService({
    secret: config.authJwtSecret,
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    accessTtlSeconds: config.jwtAccessTtlSeconds,
    now,
  });
  const refresh = new RefreshTokenService({
    store: stores.refreshTokens,
    tokens,
    refreshTtlSeconds: config.refreshTtlSeconds,
    graceMs: config.refreshGraceMs,
    now,
    audit,
  });
  const passwordReset = new PasswordResetService({
    store: stores.passwordResets,
    users: stores.users,
    passwords,
    tokens,
    ttlSeconds: config.passwordResetTtlSeconds ?? 3600,
    now,
    audit,
  });
  return { passwords, tokens, refresh, passwordReset, users: stores.users, audit, mail };
}
