/**
 * Drizzle-схема домена standalone-auth (миграция 0008, Iteration 6).
 * Источник правды — SQL-миграция; TS-схема производна (ADR-0002, принцип 6).
 *
 * refresh_tokens       — rotation + reuse detection (family_id, replaced_by, revoked_at).
 * password_reset_tokens — запрос/подтверждение сброса пароля (token_hash, used_at).
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
