/**
 * Плагин Fastify, регистрирующий слой репозиториев в зависимости от feature-флага DB_PROVIDER.
 *
 * Поведение:
 *  - В production (`NODE_ENV=production`) ОБЯЗАТЕЛЬНО `DB_PROVIDER=drizzle` — startup-инвариант.
 *    Если выставлен другой провайдер — приложение падает на старте (по принципу 2 плана).
 *  - В dev/test допустим `DB_PROVIDER=supabase` (default до Iteration 4) и `drizzle` (когда импл готова).
 *  - Drizzle-реализация вводится в Iteration 4; до этого попытка `DB_PROVIDER=drizzle` падает с явной ошибкой.
 *
 * Использование в роутах:
 *   const cp = await request.server.repos.counterparties.getById(id)
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Repositories } from '../repositories/index.js';
import { SupabaseCounterpartyRepository } from '../repositories/supabase/counterparty.supabase.js';
import { SupabaseSupplierRepository } from '../repositories/supabase/supplier.supabase.js';
import { SupabaseUserRepository } from '../repositories/supabase/user.supabase.js';

declare module 'fastify' {
  interface FastifyInstance {
    repos: Repositories;
    dbProvider: 'supabase' | 'drizzle';
  }
}

export type DbProvider = 'supabase' | 'drizzle';

/**
 * Резолюция провайдера из env с проверкой production-инварианта.
 * Экспортируется для тестов.
 */
export function resolveDbProvider(env: NodeJS.ProcessEnv): DbProvider {
  const provider = (env.DB_PROVIDER ?? 'supabase') as DbProvider;
  const nodeEnv = env.NODE_ENV ?? 'development';

  if (provider !== 'supabase' && provider !== 'drizzle') {
    throw new Error(
      `Недопустимое значение DB_PROVIDER=${provider}. Ожидается "supabase" или "drizzle".`,
    );
  }

  if (nodeEnv === 'production' && provider !== 'drizzle') {
    throw new Error(
      `В production обязателен DB_PROVIDER=drizzle (см. ADR-0001, принцип 2 плана). ` +
        `Получено: DB_PROVIDER=${provider}.`,
    );
  }

  return provider;
}

async function repositoriesPlugin(fastify: FastifyInstance): Promise<void> {
  const provider = resolveDbProvider(process.env);

  fastify.decorate('dbProvider', provider);

  if (provider === 'drizzle') {
    throw new Error(
      'DB_PROVIDER=drizzle ещё не поддерживается. Drizzle-реализация добавляется в Iteration 4.',
    );
  }

  // provider === 'supabase' — текущий runtime (Iteration 3).
  // fastify.supabase предполагается уже инициализированным databasePlugin-ом до этого момента.
  const supabase = fastify.supabase;
  if (!supabase) {
    throw new Error(
      'repositoriesPlugin требует databasePlugin зарегистрированным ранее (fastify.supabase).',
    );
  }

  const repos: Repositories = {
    counterparties: new SupabaseCounterpartyRepository(supabase),
    suppliers: new SupabaseSupplierRepository(supabase),
    users: new SupabaseUserRepository(supabase),
  };

  fastify.decorate('repos', repos);

  fastify.log.info({ dbProvider: provider }, 'Repositories registered');
}

export default fp(repositoriesPlugin, {
  name: 'repositories',
  dependencies: ['database'],
});
