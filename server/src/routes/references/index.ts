import type { FastifyInstance } from 'fastify';

import counterpartyRoutes from './counterparties.js';
import supplierRoutes from './suppliers.js';
import constructionSiteRoutes from './construction-sites.js';
import documentTypeRoutes from './document-types.js';
import costTypeRoutes from './cost-types.js';
import statusRoutes from './statuses.js';

/** Объединяющий плагин справочников — регистрирует подгруппы с префиксами */
async function referenceRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(counterpartyRoutes, { prefix: '/api/references/counterparties' });
  await fastify.register(supplierRoutes, { prefix: '/api/references/suppliers' });
  await fastify.register(constructionSiteRoutes, { prefix: '/api/references/construction-sites' });
  await fastify.register(documentTypeRoutes, { prefix: '/api/references/document-types' });
  await fastify.register(costTypeRoutes, { prefix: '/api/references/cost-types' });
  await fastify.register(statusRoutes, { prefix: '/api/references/statuses' });
}

export default referenceRoutes;
