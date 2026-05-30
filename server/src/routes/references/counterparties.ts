import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createCounterpartyBodySchema,
  updateCounterpartyBodySchema,
} from '../../schemas/counterparty.js';
import { nonEmptyString } from '../../schemas/common.js';

/* ------------------------------------------------------------------ */
/*  Параметры пути и тела                                              */
/* ------------------------------------------------------------------ */

interface IdParams {
  id: string;
}

const idParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'],
    properties: { id: { type: 'string' as const, minLength: 1 } },
  },
};

/** Импорт: фронтенд отправляет items, бэкенд исторически принимал rows — поддерживаем оба */
const batchRowSchema = z.object({ name: nonEmptyString, inn: nonEmptyString });
const batchImportBodySchema = z.object({
  items: z.array(batchRowSchema).optional(),
  rows: z.array(batchRowSchema).optional(),
});

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов контрагентов (через fastify.repos)                */
/* ------------------------------------------------------------------ */

async function counterpartyRoutes(fastify: FastifyInstance): Promise<void> {
  /** GET /api/references/counterparties — список контрагентов */
  fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user!;
    const repo = request.server.repos.counterparties;

    // counterparty_user видит только своего контрагента
    if (user.role === 'counterparty_user') {
      if (!user.counterpartyId) {
        return reply.status(403).send({ error: 'Контрагент не привязан' });
      }
      const cp = await repo.findById(user.counterpartyId);
      return cp ? [cp] : [];
    }

    return repo.listAll();
  });

  /** GET /api/references/counterparties/:id — один контрагент */
  fastify.get<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;
      // counterparty_user видит только своего контрагента
      if (user.role === 'counterparty_user' && user.counterpartyId !== id) {
        return reply.status(403).send({ error: 'Доступ запрещён' });
      }
      return request.server.repos.counterparties.getById(id);
    },
  );

  /** POST /api/references/counterparties — создание контрагента */
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request) => {
      const body = createCounterpartyBodySchema.parse(request.body);
      return request.server.repos.counterparties.create(body);
    },
  );

  /** PUT /api/references/counterparties/:id — обновление контрагента */
  fastify.put<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request) => {
      const body = updateCounterpartyBodySchema.parse(request.body);
      return request.server.repos.counterparties.update(request.params.id, body);
    },
  );

  /** DELETE /api/references/counterparties/:id — удаление контрагента */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request) => {
      await request.server.repos.counterparties.delete(request.params.id);
      return { success: true };
    },
  );

  /** POST /api/references/counterparties/batch-import — пакетный импорт */
  fastify.post(
    '/batch-import',
    { preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request, reply) => {
      const parsed = batchImportBodySchema.parse(request.body);
      const rows = parsed.items ?? parsed.rows ?? [];
      if (rows.length === 0) {
        return reply.status(400).send({ error: 'Нет данных для импорта' });
      }
      const created = await request.server.repos.counterparties.batchCreate(rows);
      return { created };
    },
  );
}

export default counterpartyRoutes;
