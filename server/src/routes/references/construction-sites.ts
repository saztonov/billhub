import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Типы тел запросов                                                  */
/* ------------------------------------------------------------------ */

interface SiteBody {
  name: string;
  isActive?: boolean;
}

interface IdParams {
  id: string;
}

/* ------------------------------------------------------------------ */
/*  JSON-схемы валидации                                               */
/* ------------------------------------------------------------------ */

const siteSchema = {
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

const idParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'],
    properties: { id: { type: 'string' as const, minLength: 1 } },
  },
};

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов объектов строительства                            */
/* ------------------------------------------------------------------ */

async function constructionSiteRoutes(fastify: FastifyInstance): Promise<void> {
  const SELECT_FIELDS = 'id, name, is_active, created_at';

  /** GET /api/references/construction-sites — список объектов */
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request, reply) => {
      const { data, error } = await request.server.supabase
        .from('construction_sites')
        .select(SELECT_FIELDS)
        .order('created_at', { ascending: false });
      if (error) return reply.status(500).send({ error: error.message });
      return data;
    }
  );

  /** GET /api/references/construction-sites/:id — один объект */
  fastify.get<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request, reply) => {
      const { id } = request.params;
      const { data, error } = await request.server.supabase
        .from('construction_sites')
        .select(SELECT_FIELDS)
        .eq('id', id)
        .single();
      if (error) return reply.status(404).send({ error: 'Объект не найден' });
      return data;
    }
  );

  /** POST /api/references/construction-sites — создание объекта */
  fastify.post<{ Body: SiteBody }>(
    '/',
    { schema: siteSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { name, isActive } = request.body;
      const { data, error } = await request.server.supabase
        .from('construction_sites')
        .insert({ name, is_active: isActive ?? true })
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** PUT /api/references/construction-sites/:id — обновление объекта */
  fastify.put<{ Params: IdParams; Body: SiteBody }>(
    '/:id',
    { schema: { ...idParamsSchema, ...siteSchema }, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { name, isActive } = request.body;
      const { data, error } = await request.server.supabase
        .from('construction_sites')
        .update({ name, is_active: isActive })
        .eq('id', id)
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** DELETE /api/references/construction-sites/:id — удаление объекта */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { error } = await request.server.supabase
        .from('construction_sites')
        .delete()
        .eq('id', id);
      if (error) return reply.status(400).send({ error: error.message });
      return { success: true };
    }
  );
}

export default fp(constructionSiteRoutes, { name: 'construction-site-routes' });
