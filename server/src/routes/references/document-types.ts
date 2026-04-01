import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Типы тел запросов                                                  */
/* ------------------------------------------------------------------ */

interface DocumentTypeBody {
  name: string;
  category?: string;
}

interface DocumentTypeQuery {
  category?: string;
}

interface IdParams {
  id: string;
}

/* ------------------------------------------------------------------ */
/*  JSON-схемы валидации                                               */
/* ------------------------------------------------------------------ */

const documentTypeSchema = {
  body: {
    type: 'object' as const,
    required: ['name'],
    properties: {
      name: { type: 'string' as const, minLength: 1 },
      category: { type: 'string' as const, enum: ['operational', 'founding'], nullable: true },
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
/*  Плагин маршрутов типов документов                                  */
/* ------------------------------------------------------------------ */

async function documentTypeRoutes(fastify: FastifyInstance): Promise<void> {
  const SELECT_FIELDS = 'id, name, category, created_at';

  /** GET /api/references/document-types — список типов документов */
  fastify.get<{ Querystring: DocumentTypeQuery }>(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'user', 'counterparty_user')] },
    async (request, reply) => {
      const { category } = request.query as DocumentTypeQuery;
      let query = request.server.supabase
        .from('document_types')
        .select(SELECT_FIELDS);

      if (category) {
        query = query.eq('category', category);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) return reply.status(500).send({ error: error.message });
      return data;
    }
  );

  /** POST /api/references/document-types — создание типа документа */
  fastify.post<{ Body: DocumentTypeBody }>(
    '/',
    { schema: documentTypeSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { name, category } = request.body;
      const insertData: Record<string, unknown> = { name };
      if (category) insertData['category'] = category;
      const { data, error } = await request.server.supabase
        .from('document_types')
        .insert(insertData)
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** PUT /api/references/document-types/:id — обновление типа документа */
  fastify.put<{ Params: IdParams; Body: DocumentTypeBody }>(
    '/:id',
    { schema: { ...idParamsSchema, ...documentTypeSchema }, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { name, category } = request.body;
      const updateData: Record<string, unknown> = { name };
      if (category) updateData['category'] = category;
      const { data, error } = await request.server.supabase
        .from('document_types')
        .update(updateData)
        .eq('id', id)
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** DELETE /api/references/document-types/:id — удаление типа документа */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { error } = await request.server.supabase
        .from('document_types')
        .delete()
        .eq('id', id);
      if (error) return reply.status(400).send({ error: error.message });
      return { success: true };
    }
  );
}

export default documentTypeRoutes;
