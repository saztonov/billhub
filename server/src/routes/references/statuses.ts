import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Типы                                                               */
/* ------------------------------------------------------------------ */

interface StatusQuery {
  entityType: string;
}

interface StatusBody {
  entityType: string;
  code: string;
  name: string;
  color?: string;
  isActive?: boolean;
  displayOrder?: number;
  visibleRoles?: string[];
}

interface StatusUpdateBody {
  code?: string;
  name?: string;
  color?: string;
  isActive?: boolean;
  displayOrder?: number;
  visibleRoles?: string[];
}

interface IdParams {
  id: string;
}

/* ------------------------------------------------------------------ */
/*  JSON-схемы валидации                                               */
/* ------------------------------------------------------------------ */

const querySchema = {
  querystring: {
    type: 'object' as const,
    required: ['entityType'],
    properties: {
      entityType: { type: 'string' as const, minLength: 1 },
    },
  },
};

const statusCreateSchema = {
  body: {
    type: 'object' as const,
    required: ['entityType', 'code', 'name'],
    properties: {
      entityType: { type: 'string' as const, minLength: 1 },
      code: { type: 'string' as const, minLength: 1 },
      name: { type: 'string' as const, minLength: 1 },
      color: { type: 'string' as const },
      isActive: { type: 'boolean' as const },
      displayOrder: { type: 'number' as const },
      visibleRoles: { type: 'array' as const, items: { type: 'string' as const } },
    },
    additionalProperties: false,
  },
};

const statusUpdateSchema = {
  body: {
    type: 'object' as const,
    properties: {
      code: { type: 'string' as const },
      name: { type: 'string' as const },
      color: { type: 'string' as const },
      isActive: { type: 'boolean' as const },
      displayOrder: { type: 'number' as const },
      visibleRoles: { type: 'array' as const, items: { type: 'string' as const } },
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
/*  Плагин маршрутов статусов                                          */
/* ------------------------------------------------------------------ */

async function statusRoutes(fastify: FastifyInstance): Promise<void> {
  const SELECT_FIELDS = 'id, entity_type, code, name, color, is_active, display_order, visible_roles, created_at';

  /** GET /api/references/statuses?entityType=xxx — статусы по типу сущности */
  fastify.get<{ Querystring: StatusQuery }>(
    '/',
    { schema: querySchema, preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request, reply) => {
      const { entityType } = request.query;
      const { data, error } = await request.server.supabase
        .from('statuses')
        .select(SELECT_FIELDS)
        .eq('entity_type', entityType)
        .order('display_order', { ascending: true });
      if (error) return reply.status(500).send({ error: error.message });
      return data;
    }
  );

  /** POST /api/references/statuses — создание статуса */
  fastify.post<{ Body: StatusBody }>(
    '/',
    { schema: statusCreateSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { entityType, code, name, color, isActive, displayOrder, visibleRoles } = request.body;
      const { data, error } = await request.server.supabase
        .from('statuses')
        .insert({
          entity_type: entityType,
          code,
          name,
          color: color ?? null,
          is_active: isActive ?? true,
          display_order: displayOrder ?? 0,
          visible_roles: visibleRoles ?? [],
        })
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** PUT /api/references/statuses/:id — обновление статуса */
  fastify.put<{ Params: IdParams; Body: StatusUpdateBody }>(
    '/:id',
    { schema: { ...idParamsSchema, ...statusUpdateSchema }, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { code, name, color, isActive, displayOrder, visibleRoles } = request.body;

      // Формируем объект обновления только из переданных полей
      const updateData: Record<string, unknown> = {};
      if (code !== undefined) updateData.code = code;
      if (name !== undefined) updateData.name = name;
      if (color !== undefined) updateData.color = color;
      if (isActive !== undefined) updateData.is_active = isActive;
      if (displayOrder !== undefined) updateData.display_order = displayOrder;
      if (visibleRoles !== undefined) updateData.visible_roles = visibleRoles;

      const { data, error } = await request.server.supabase
        .from('statuses')
        .update(updateData)
        .eq('id', id)
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** DELETE /api/references/statuses/:id — удаление статуса */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { error } = await request.server.supabase
        .from('statuses')
        .delete()
        .eq('id', id);
      if (error) return reply.status(400).send({ error: error.message });
      return { success: true };
    }
  );
}

export default statusRoutes;
