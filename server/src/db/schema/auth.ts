/**
 * Drizzle-схема домена auth.
 * Источник правды — SQL-миграция; TS-схема производна (ADR-0002, принцип 6).
 *
 * refresh_tokens       — rotation + reuse detection (family_id, replaced_by, revoked_at).
 * password_reset_tokens — запрос/подтверждение сброса пароля (token_hash, used_at).
 * user_identity_links  — связь идентичности Keycloak (provider, subject) с users.id (миграция 0009).
 */
import { inet, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  familyId: uuid('family_id').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  replacedBy: uuid('replaced_by'),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
  ip: inet('ip'),
  userAgent: text('user_agent'),
});

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
});

/**
 * Связь идентичности Keycloak с пользователем BillHub (миграция 0009, OIDC/BFF).
 *   provider      — 'keycloak-local' сейчас; 'keycloak-ad' при подключении AD-федерации.
 *   subject       — Keycloak sub (text, не uuid — future-proof под смену provider/subject при AD).
 *   email_at_link — снимок email на момент привязки (устойчивый якорь one-time email-привязки).
 * Индексы (в SQL-миграции): UNIQUE (provider, subject); (user_id); (lower(email_at_link)).
 */
export const userIdentityLinks = pgTable('user_identity_links', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  subject: text('subject').notNull(),
  emailAtLink: text('email_at_link'),
  linkedAt: timestamp('linked_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }),
});
