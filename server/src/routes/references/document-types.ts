import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Типы тел запросов                                                  */
/* ------------------------------------------------------------------ */

interface DocumentTypeBody {
  name: string;
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
  const SELECT_FIELDS = 'id, name, created_at';

  /** GET /api/references/document-types — список типов документов */
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'user', 'counterparty_user')] },
    async (request, reply) => {
      const { data, error } = await request.server.supabase
        .from('document_types')
        .select(SELECT_FIELDS)
        .order('created_at', { ascending: false });
      if (error) return reply.status(500).send({ error: error.message });
      return data;
    }
  );

  /** POST /api/references/document-types — создание типа документа */
  fastify.post<{ Body: DocumentTypeBody }>(
    '/',
    { schema: documentTypeSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { name } = request.body;
      const { data, error } = await request.server.supabase
        .from('document_types')
        .insert({ name })
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
      const { name } = request.body;
      const { data, error } = await request.server.supabase
        .from('document_types')
        .update({ name })
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
