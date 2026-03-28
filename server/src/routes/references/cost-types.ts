import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Типы тел запросов                                                  */
/* ------------------------------------------------------------------ */

interface CostTypeBody {
  name: string;
  isActive?: boolean;
}

interface BatchImportBody {
  names: string[];
}

interface IdParams {
  id: string;
}

/* ------------------------------------------------------------------ */
/*  JSON-схемы валидации                                               */
/* ------------------------------------------------------------------ */

const costTypeSchema = {
  body: {
    type: 'object' as const,
    required: ['name'],
    properties: {
      name: { type: 'string' as const, minLength: 1 },
      isActive: { type: 'boolean' as const },
    },
    additionalProperties: false,
  },
};

const batchImportSchema = {
  body: {
    type: 'object' as const,
    required: ['names'],
    properties: {
      names: {
        type: 'array' as const,
        items: { type: 'string' as const, minLength: 1 },
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
/*  Плагин маршрутов видов затрат                                      */
/* ------------------------------------------------------------------ */

async function costTypeRoutes(fastify: FastifyInstance): Promise<void> {
  const SELECT_FIELDS = 'id, name, is_active, created_at';

  /** GET /api/references/cost-types — список видов затрат */
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request, reply) => {
      const { data, error } = await request.server.supabase
        .from('cost_types')
        .select(SELECT_FIELDS)
        .order('name', { ascending: true });
      if (error) return reply.status(500).send({ error: error.message });
      return data;
    }
  );

  /** POST /api/references/cost-types — создание вида затрат */
  fastify.post<{ Body: CostTypeBody }>(
    '/',
    { schema: costTypeSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { name } = request.body;
      const { data, error } = await request.server.supabase
        .from('cost_types')
        .insert({ name })
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** PUT /api/references/cost-types/:id — обновление вида затрат */
  fastify.put<{ Params: IdParams; Body: CostTypeBody }>(
    '/:id',
    { schema: { ...idParamsSchema, ...costTypeSchema }, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { name, isActive } = request.body;
      const { data, error } = await request.server.supabase
        .from('cost_types')
        .update({ name, is_active: isActive })
        .eq('id', id)
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** DELETE /api/references/cost-types/:id — удаление вида затрат */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { error } = await request.server.supabase
        .from('cost_types')
        .delete()
        .eq('id', id);
      if (error) return reply.status(400).send({ error: error.message });
      return { success: true };
    }
  );

  /** POST /api/references/cost-types/batch-import — пакетный импорт */
  fastify.post<{ Body: BatchImportBody }>(
    '/batch-import',
    { schema: batchImportSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { names } = request.body;
      const BATCH_SIZE = 20;
      let created = 0;

      for (let i = 0; i < names.length; i += BATCH_SIZE) {
        const batch = names.slice(i, i + BATCH_SIZE).map((name) => ({ name }));
        const { error } = await request.server.supabase.from('cost_types').insert(batch);
        if (error) return reply.status(400).send({ error: error.message });
        created += batch.length;
      }

      return { created };
    }
  );
}

export default fp(costTypeRoutes, { name: 'cost-type-routes' });
