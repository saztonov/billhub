import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Типы тел запросов                                                  */
/* ------------------------------------------------------------------ */

interface SupplierBody {
  name: string;
  inn: string;
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

const supplierSchema = {
  body: {
    type: 'object' as const,
    required: ['name', 'inn'],
    properties: {
      name: { type: 'string' as const, minLength: 1 },
      inn: { type: 'string' as const, minLength: 1 },
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
/*  Плагин маршрутов поставщиков                                       */
/* ------------------------------------------------------------------ */

async function supplierRoutes(fastify: FastifyInstance): Promise<void> {
  const SELECT_FIELDS = 'id, name, inn, alternative_names, created_at';

  /** GET /api/references/suppliers — список поставщиков */
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request, reply) => {
      const { data, error } = await request.server.supabase
        .from('suppliers')
        .select(SELECT_FIELDS)
        .order('created_at', { ascending: false });
      if (error) return reply.status(500).send({ error: error.message });
      return data;
    }
  );

  /** GET /api/references/suppliers/:id — один поставщик */
  fastify.get<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request, reply) => {
      const { id } = request.params;
      const { data, error } = await request.server.supabase
        .from('suppliers')
        .select(SELECT_FIELDS)
        .eq('id', id)
        .single();
      if (error) return reply.status(404).send({ error: 'Поставщик не найден' });
      return data;
    }
  );

  /** POST /api/references/suppliers — создание поставщика */
  fastify.post<{ Body: SupplierBody }>(
    '/',
    { schema: supplierSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { name, inn, alternativeNames } = request.body;
      const { data, error } = await request.server.supabase
        .from('suppliers')
        .insert({ name, inn, alternative_names: alternativeNames ?? [] })
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** PUT /api/references/suppliers/:id — обновление поставщика */
  fastify.put<{ Params: IdParams; Body: SupplierBody }>(
    '/:id',
    { schema: { ...idParamsSchema, ...supplierSchema }, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { name, inn, alternativeNames } = request.body;
      const { data, error } = await request.server.supabase
        .from('suppliers')
        .update({ name, inn, alternative_names: alternativeNames })
        .eq('id', id)
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** DELETE /api/references/suppliers/:id — удаление поставщика */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { error } = await request.server.supabase
        .from('suppliers')
        .delete()
        .eq('id', id);
      if (error) return reply.status(400).send({ error: error.message });
      return { success: true };
    }
  );

  /** POST /api/references/suppliers/batch-import — пакетный импорт */
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
          alternative_names: [] as string[],
        }));
        const { error } = await request.server.supabase.from('suppliers').insert(batch);
        if (error) return reply.status(400).send({ error: error.message });
        created += batch.length;
      }

      return { created };
    }
  );
}

export default supplierRoutes;
