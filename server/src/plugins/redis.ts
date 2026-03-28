import fp from 'fastify-plugin';
import IORedis from 'ioredis';
import { config } from '../config.js';
import type { FastifyInstance } from 'fastify';

/** Плагин подключения к Redis */
async function redisPlugin(fastify: FastifyInstance): Promise<void> {
  const redis = new IORedis.default(config.redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
  });

  redis.on('error', (err: Error) => {
    fastify.log.error({ err }, 'Ошибка подключения к Redis');
  });

  redis.on('connect', () => {
    fastify.log.info('Redis подключен');
  });

  fastify.decorate('redis', redis);

  /** Корректное завершение при остановке сервера */
  fastify.addHook('onClose', async () => {
    await redis.quit();
    fastify.log.info('Redis соединение закрыто');
  });
}

export default fp(redisPlugin, {
  name: 'redis',
});
