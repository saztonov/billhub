import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';

/** Маршруты проверки состояния сервера */
export default async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  /** Базовая проверка — сервер работает */
  fastify.get('/api/health', async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  });

  /** Полная проверка готовности — БД и Redis (проба активного провайдера БД) */
  fastify.get('/api/health/ready', async () => {
    let database = false;
    let redis = false;

    // Проба БД активного провайдера: drizzle → fastify.db; supabase (rollback) → fastify.supabase.
    if (fastify.dbProvider === 'drizzle' && fastify.db) {
      try {
        await fastify.db.execute(sql`select 1`);
        database = true;
      } catch {
        database = false;
      }
    } else {
      try {
        const { error } = await fastify.supabase.rpc('', {});
        if (error) {
          const { error: selectError } = await fastify.supabase.from('users').select('id').limit(1);
          database = !selectError;
        } else {
          database = true;
        }
      } catch {
        database = false;
      }
    }

    /** Проверка подключения к Redis */
    try {
      const pong = await fastify.redis.ping();
      redis = pong === 'PONG';
    } catch {
      redis = false;
    }

    return {
      status: database && redis ? 'ok' : 'degraded',
      database,
      redis,
    };
  });
}
