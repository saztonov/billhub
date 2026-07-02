/**
 * Плагин Drizzle (postgres.js). Активен ТОЛЬКО при DB_PROVIDER=drizzle.
 *
 * При DB_PROVIDER=supabase (default до Iteration 5) — no-op: не открывает соединений,
 * не декорирует fastify.db. Supabase-клиент (databasePlugin) остаётся в коде по принципу 2.
 *
 * Регистрируется ДО repositoriesPlugin; тот при DB_PROVIDER=drizzle берёт fastify.db.
 */
import fp from 'fastify-plugin';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import * as schema from '../db/schema/index.js';
import { config } from '../config.js';
import { resolveDbProvider } from './repositories.js';

export type BillhubDatabase = PostgresJsDatabase<typeof schema>;

declare module 'fastify' {
  interface FastifyInstance {
    /** Drizzle-клиент. Определён только при DB_PROVIDER=drizzle. */
    db?: BillhubDatabase;
  }
}

async function databaseDrizzlePlugin(fastify: FastifyInstance): Promise<void> {
  const provider = resolveDbProvider(process.env);
  if (provider !== 'drizzle') {
    fastify.log.info('database-drizzle: DB_PROVIDER!=drizzle — плагин неактивен (no-op)');
    return;
  }

  const url = config.databaseUrl;
  if (!url) {
    throw new Error('DB_PROVIDER=drizzle требует переменную окружения DATABASE_URL.');
  }
  // Защита от нечислового DATABASE_POOL_MAX (NaN сломал бы пул postgres.js).
  const max =
    Number.isFinite(config.databasePoolMax) && config.databasePoolMax > 0
      ? config.databasePoolMax
      : 10;

  // prepare: false — пул Yandex Managed PG на :6432 работает в transaction mode,
  // где prepared statements через переиспользуемые соединения ломаются.
  const client = postgres(url, { max, prepare: false, onnotice: () => {} });
  const db = drizzle(client, { schema });

  fastify.decorate('db', db);
  fastify.addHook('onClose', async () => {
    await client.end({ timeout: 5 });
  });

  fastify.log.info({ poolMax: max }, 'database-drizzle: Drizzle (postgres.js) инициализирован');
}

export default fp(databaseDrizzlePlugin, { name: 'database-drizzle' });
