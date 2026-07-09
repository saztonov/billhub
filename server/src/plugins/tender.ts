import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createTenderClientFromEnv } from '../services/tender/tender-client.js';

/**
 * Плагин интеграции тендерного портала: декорирует fastify.tender клиентом.
 * Соединений не открывает — регистрируется вне skipInfra. null — не настроено
 * (TENDER_BASE_URL/TENDER_API_TOKEN не заданы); валидное состояние.
 */
async function tenderPlugin(fastify: FastifyInstance): Promise<void> {
  const client = createTenderClientFromEnv();
  fastify.decorate('tender', client);
  fastify.log.info(
    client
      ? `Интеграция тендерного портала настроена (${client.baseUrl})`
      : 'Интеграция тендерного портала не настроена (TENDER_BASE_URL/TENDER_API_TOKEN не заданы)',
  );
}

export default fp(tenderPlugin, {
  name: 'tender',
});
