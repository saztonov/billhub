import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Типы тел запросов                                                  */
/* ------------------------------------------------------------------ */

interface CounterpartyBody {
  name: string;
  inn: string;
  address?: string;
  alternativeNames?: string[];
}

interface BatchImportBody {
  rows: { name: string; inn: string }[];
}

interface IdParams {
  id: string;
}

/* ------------------------------------------------------------------ */
/*  JSON-схемы валидации                                               */
/* ------------------------------------------------------------------ */

const counterpartySchema = {
  body: {
    type: 'object' as const,
    required: ['name', 'inn'],
    properties: {
      name: { type: 'string' as const, minLength: 1 },
      inn: { type: 'string' as const, minLength: 1 },
      address: { type: 'string' as const },
      alternativeNames: { type: 'array' as const, items: { type: 'string' as const } },
    },
    additionalProperties: false,
  },
};

const batchImportSchema = {
  body: {
    type: 'object' as const,
    required: ['rows'],
    properties: {
      rows: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          required: ['name', 'inn'],
          properties: {
            name: { type: 'string' as const, minLength: 1 },
            inn: { type: 'string' as const, minLength: 1 },
          },
          additionalProperties: false,
        },
        minItems: 1,
      },
    },
    additionalProperties: false,
  },
};

const idParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'],
    properties: { id: { type: 'string' as const, minLength: 1 } },
  },
};

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов контрагентов                                      */
/* ------------------------------------------------------------------ */

async function counterpartyRoutes(fastify: FastifyInstance): Promise<void> {
  const SELECT_FIELDS = 'id, name, inn, address, alternative_names, registration_token, created_at';

  /** GET /api/references/counterparties — список контрагентов */
  fastify.get(
    '/',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user!;

      // counterparty_user видит только своего контрагента
      if (user.role === 'counterparty_user') {
        if (!user.counterpartyId) {
          return reply.status(403).send({ error: 'Контрагент не привязан' });
        }
        const { data, error } = await request.server.supabase
          .from('counterparties')
          .select(SELECT_FIELDS)
          .eq('id', user.counterpartyId);
        if (error) return reply.status(500).send({ error: error.message });
        return data;
      }

      const { data, error } = await request.server.supabase
        .from('counterparties')
        .select(SELECT_FIELDS)
        .order('created_at', { ascending: false });
      if (error) return reply.status(500).send({ error: error.message });
      return data;
    }
  );

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

      const { data, error } = await request.server.supabase
        .from('counterparties')
        .select(SELECT_FIELDS)
        .eq('id', id)
        .single();
      if (error) return reply.status(404).send({ error: 'Контрагент не найден' });
      return data;
    }
  );

  /** POST /api/references/counterparties — создание контрагента */
  fastify.post<{ Body: CounterpartyBody }>(
    '/',
    { schema: counterpartySchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { name, inn, address, alternativeNames } = request.body;
      const { data, error } = await request.server.supabase
        .from('counterparties')
        .insert({ name, inn, address: address || '', alternative_names: alternativeNames ?? [] })
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** PUT /api/references/counterparties/:id — обновление контрагента */
  fastify.put<{ Params: IdParams; Body: CounterpartyBody }>(
    '/:id',
    { schema: { ...idParamsSchema, ...counterpartySchema }, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { name, inn, address, alternativeNames } = request.body;
      const { data, error } = await request.server.supabase
        .from('counterparties')
        .update({ name, inn, address, alternative_names: alternativeNames })
        .eq('id', id)
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** DELETE /api/references/counterparties/:id — удаление контрагента */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { error } = await request.server.supabase
        .from('counterparties')
        .delete()
        .eq('id', id);
      if (error) return reply.status(400).send({ error: error.message });
      return { success: true };
    }
  );

  /** POST /api/references/counterparties/batch-import — пакетный импорт */
  fastify.post<{ Body: BatchImportBody }>(
    '/batch-import',
    { schema: batchImportSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { rows } = request.body;
      const BATCH_SIZE = 20;
      let created = 0;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({
          name: r.name,
          inn: r.inn,
          address: '',
          alternative_names: [] as string[],
        }));
        const { error } = await request.server.supabase.from('counterparties').insert(batch);
        if (error) return reply.status(400).send({ error: error.message });
        created += batch.length;
      }

      return { created };
    }
  );
}

export default counterpartyRoutes;
