import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createPayHubClientFromEnv } from '../services/payhub/payhub-client.js';

/**
 * Плагин интеграции PayHub: декорирует fastify.payhub типизированным клиентом
 * внешнего API PayHub. Соединений не открывает — только конструирует объект,
 * поэтому регистрируется вне блока skipInfra.
 *
 * null — интеграция не настроена (PAYHUB_BASE_URL/PAYHUB_API_TOKEN не заданы);
 * это валидное состояние, сервис работает без PayHub.
 */
async function payhubPlugin(fastify: FastifyInstance): Promise<void> {
  const client = createPayHubClientFromEnv();
  fastify.decorate('payhub', client);
  fastify.log.info(
    client
      ? `Интеграция PayHub настроена (${client.baseUrl})`
      : 'Интеграция PayHub не настроена (PAYHUB_BASE_URL/PAYHUB_API_TOKEN не заданы)',
  );
}

export default fp(payhubPlugin, {
  name: 'payhub',
});
