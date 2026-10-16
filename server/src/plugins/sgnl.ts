import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createSgnlClientFromEnv } from '../services/sgnl/sgnl-client.js';

/**
 * Плагин интеграции SIGNAL DOCS: декорирует fastify.sgnl клиентом публичного API.
 * Соединений не открывает — регистрируется вне блока skipInfra.
 *
 * null — интеграция не настроена (SGNL_CLIENT_ID/SGNL_CLIENT_SECRET не заданы);
 * это валидное состояние, сервис работает без SIGNAL.
 */
async function sgnlPlugin(fastify: FastifyInstance): Promise<void> {
  const client = createSgnlClientFromEnv();
  fastify.decorate('sgnl', client);
  fastify.log.info(
    client
      ? `Интеграция SIGNAL настроена (${client.baseUrl})`
      : 'Интеграция SIGNAL не настроена (SGNL_CLIENT_ID/SGNL_CLIENT_SECRET не заданы)',
  );
}

export default fp(sgnlPlugin, {
  name: 'sgnl',
});
