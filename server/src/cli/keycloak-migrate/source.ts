/**
 * Ф3 — PG-адаптеры: чтение `public.users` (SourceReader), запись зеркала `is_active` (MirrorWriter,
 * только reconcile) и линки идентичности через готовый DrizzleIdentityLinkStore. Один postgres.js
 * коннект (max:1, prepare:false — как в import-passwords/migrate) на всё.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../db/schema/index.js';
import { DrizzleIdentityLinkStore } from '../../services/auth/stores/pg.js';
import type { LinkStore, MigrationUser, MirrorWriter, SourceReader } from './types.js';

export interface PgAdapters {
  source: SourceReader;
  mirror: MirrorWriter;
  links: LinkStore;
  /** Advisory-lock против параллельного запуска (mutating-режимы). */
  tryAdvisoryLock(key: number): Promise<boolean>;
  advisoryUnlock(key: number): Promise<void>;
  close(): Promise<void>;
}

export function createPgAdapters(databaseUrl: string): PgAdapters {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {}, prepare: false });
  const db = drizzle(sql, { schema });
  const links = new DrizzleIdentityLinkStore(db);

  const source: SourceReader = {
    async readUsers(): Promise<MigrationUser[]> {
      const rows = await sql<
        {
          id: string;
          email: string | null;
          full_name: string | null;
          role: string;
          counterparty_id: string | null;
          is_active: boolean;
          password_hash: string | null;
        }[]
      >`
        SELECT id, email::text AS email, full_name, role, counterparty_id, is_active, password_hash
        FROM public.users
        ORDER BY id
      `;
      return rows.map((r) => ({
        id: r.id,
        email: r.email ?? '',
        fullName: r.full_name ?? '',
        role: r.role,
        counterpartyId: r.counterparty_id,
        isActive: r.is_active,
        passwordHash: r.password_hash,
      }));
    },
  };

  const mirror: MirrorWriter = {
    async setActive(userId: string, active: boolean): Promise<number> {
      const res = await sql`
        UPDATE public.users SET is_active = ${active} WHERE id = ${userId}
      `;
      return res.count;
    },
  };

  return {
    source,
    mirror,
    links,
    async tryAdvisoryLock(key: number): Promise<boolean> {
      const [row] = await sql<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${key}) AS locked`;
      return row?.locked ?? false;
    },
    async advisoryUnlock(key: number): Promise<void> {
      await sql`SELECT pg_advisory_unlock(${key})`;
    },
    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}
