import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createEstimatClientFromEnv } from '../services/estimat/estimat-client.js';

/**
 * Плагин исходящей интеграции EstiMat: декорирует fastify.estimat клиентом канала событий.
 * Соединений не открывает — регистрируется вне skipInfra.
 * null — интеграция не настроена или выключен рубильник ESTIMAT_SYNC_ENABLED (валидное
 * состояние: события копятся в integration_outbox со статусом waiting_config).
 */
async function estimatPlugin(fastify: FastifyInstance): Promise<void> {
  const client = createEstimatClientFromEnv();
  fastify.decorate('estimat', client);
  fastify.log.info(
    client
      ? `Интеграция EstiMat (исходящие события) настроена (${client.baseUrl})`
      : 'Интеграция EstiMat (исходящие события) не настроена/выключена',
  );
}

export default fp(estimatPlugin, {
  name: 'estimat',
});
