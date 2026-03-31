import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Типы                                                               */
/* ------------------------------------------------------------------ */

interface FieldOptionQuery {
  fieldCode?: string;
}

interface FieldOptionBody {
  fieldCode: string;
  value: string;
  isActive?: boolean;
  displayOrder?: number;
}

interface FieldOptionUpdateBody {
  value?: string;
  isActive?: boolean;
  displayOrder?: number;
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
    properties: {
      fieldCode: { type: 'string' as const },
    },
  },
};

const fieldOptionCreateSchema = {
  body: {
    type: 'object' as const,
    required: ['fieldCode', 'value'],
    properties: {
      fieldCode: { type: 'string' as const, minLength: 1 },
      value: { type: 'string' as const, minLength: 1 },
      isActive: { type: 'boolean' as const },
      displayOrder: { type: 'number' as const },
    },
    additionalProperties: false,
  },
};

const fieldOptionUpdateSchema = {
  body: {
    type: 'object' as const,
    properties: {
      value: { type: 'string' as const },
      isActive: { type: 'boolean' as const },
      displayOrder: { type: 'number' as const },
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
/*  Плагин маршрутов опций полей заявок на оплату                      */
/* ------------------------------------------------------------------ */

async function fieldOptionRoutes(fastify: FastifyInstance): Promise<void> {
  const SELECT_FIELDS = 'id, field_code, value, is_active, display_order, created_at';

  /** GET /api/references/field-options — список опций (с фильтром по fieldCode) */
  fastify.get<{ Querystring: FieldOptionQuery }>(
    '/',
    { schema: querySchema, preHandler: [authenticate, requireRole('admin', 'user', 'counterparty_user')] },
    async (request, reply) => {
      const { fieldCode } = request.query;
      let query = request.server.supabase
        .from('payment_request_field_options')
        .select(SELECT_FIELDS)
        .order('field_code', { ascending: true })
        .order('display_order', { ascending: true });

      if (fieldCode) {
        query = query.eq('field_code', fieldCode);
      }

      const { data, error } = await query;
      if (error) return reply.status(500).send({ error: error.message });
      return data;
    }
  );

  /** POST /api/references/field-options — создание опции */
  fastify.post<{ Body: FieldOptionBody }>(
    '/',
    { schema: fieldOptionCreateSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { fieldCode, value, isActive, displayOrder } = request.body;
      const { data, error } = await request.server.supabase
        .from('payment_request_field_options')
        .insert({
          field_code: fieldCode,
          value,
          is_active: isActive ?? true,
          display_order: displayOrder ?? 0,
        })
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** PUT /api/references/field-options/:id — обновление опции */
  fastify.put<{ Params: IdParams; Body: FieldOptionUpdateBody }>(
    '/:id',
    { schema: { ...idParamsSchema, ...fieldOptionUpdateSchema }, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { value, isActive, displayOrder } = request.body;

      const updateData: Record<string, unknown> = {};
      if (value !== undefined) updateData.value = value;
      if (isActive !== undefined) updateData.is_active = isActive;
      if (displayOrder !== undefined) updateData.display_order = displayOrder;

      const { data, error } = await request.server.supabase
        .from('payment_request_field_options')
        .update(updateData)
        .eq('id', id)
        .select(SELECT_FIELDS)
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return data;
    }
  );

  /** DELETE /api/references/field-options/:id — удаление опции */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { error } = await request.server.supabase
        .from('payment_request_field_options')
        .delete()
        .eq('id', id);
      if (error) return reply.status(400).send({ error: error.message });
      return { success: true };
    }
  );
}

export default fieldOptionRoutes;
