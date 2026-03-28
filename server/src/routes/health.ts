import type { FastifyInstance } from 'fastify';

/** Маршруты проверки состояния сервера */
export default async function healthRoutes(
  fastify: FastifyInstance
): Promise<void> {
  /** Базовая проверка — сервер работает */
  fastify.get('/api/health', async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  });

  /** Полная проверка готовности — БД и Redis */
  fastify.get('/api/health/ready', async () => {
    let database = false;
    let redis = false;

    /** Проверка подключения к Supabase */
    try {
      const { error } = await fastify.supabase.rpc('', {});
      // Если rpc недоступен, пробуем простой запрос
      if (error) {
        const { error: selectError } = await fastify.supabase
          .from('users')
          .select('id')
          .limit(1);
        database = !selectError;
      } else {
        database = true;
      }
    } catch {
      database = false;
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
