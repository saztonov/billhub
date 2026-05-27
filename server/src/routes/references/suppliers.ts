import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { SB_REVIEW_CUTOFF_DATE } from '../../config/sbReview.js';

/* ------------------------------------------------------------------ */
/*  Типы тел запросов и параметров                                     */
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

interface ListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  sbFilter?: 'all' | 'pending';
}

interface SbDecisionBody {
  decision: 'approved' | 'rejected';
  comment?: string;
}

interface SbRpcRow {
  id: string;
  name: string;
  inn: string;
  alternative_names: string[] | null;
  created_at: string;
  last_security_status: 'approved' | 'rejected' | null;
  last_security_at: string | null;
  has_pending_request: boolean;
  total_count: number;
}

/** Маппинг snake_case RPC-строки в camelCase ответ API */
function mapSupplierRow(row: SbRpcRow) {
  return {
    id: row.id,
    name: row.name,
    inn: row.inn,
    alternativeNames: row.alternative_names ?? [],
    createdAt: row.created_at,
    lastSecurityCheck: row.last_security_status && row.last_security_at
      ? { status: row.last_security_status, createdAt: row.last_security_at }
      : null,
    hasPendingRequest: !!row.has_pending_request,
  };
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

const sbDecisionSchema = {
  body: {
    type: 'object' as const,
    required: ['decision'],
    properties: {
      decision: { type: 'string' as const, enum: ['approved', 'rejected'] },
      comment: { type: 'string' as const },
    },
    additionalProperties: false,
  },
};

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов поставщиков                                       */
/* ------------------------------------------------------------------ */

async function supplierRoutes(fastify: FastifyInstance): Promise<void> {
  const SELECT_FIELDS = 'id, name, inn, alternative_names, created_at';

  /** GET /api/references/suppliers — список поставщиков
   *  Без query.page возвращается обратно-совместимый массив без SB-агрегатов.
   *  При наличии query.page включается серверная пагинация с агрегатами по СБ. */
  fastify.get<{ Querystring: ListQuery }>(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'user', 'counterparty_user', 'security')] },
    async (request, reply) => {
      const { page: pageRaw, pageSize: pageSizeRaw, search, sbFilter } = request.query;
      const isPaginated = pageRaw !== undefined;

      if (!isPaginated) {
        const { data, error } = await request.server.supabase
          .from('suppliers')
          .select(SELECT_FIELDS)
          .order('created_at', { ascending: false });
        if (error) return reply.status(500).send({ error: error.message });
        return data;
      }

      const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeRaw ?? '20', 10) || 20));
      const filter: 'all' | 'pending' = sbFilter === 'pending' ? 'pending' : 'all';

      const { data, error } = await request.server.supabase.rpc('list_suppliers_with_sb', {
        p_search: search ?? null,
        p_sb_filter: filter,
        p_page: page,
        p_page_size: pageSize,
        p_cutoff_date: SB_REVIEW_CUTOFF_DATE,
        p_only_supplier_id: null,
      });

      if (error) return reply.status(500).send({ error: error.message });

      const rows = (data ?? []) as SbRpcRow[];
      const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
      return { items: rows.map(mapSupplierRow), total, page, pageSize };
    }
  );

  /** GET /api/references/suppliers/:id — один поставщик */
  fastify.get<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin', 'user', 'security')] },
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
    { schema: supplierSchema, preHandler: [authenticate, requireRole('admin', 'user')] },
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
    { schema: { ...idParamsSchema, ...supplierSchema }, preHandler: [authenticate, requireRole('admin', 'user')] },
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
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin', 'user')] },
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
    { schema: batchImportSchema, preHandler: [authenticate, requireRole('admin', 'user')] },
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

  /* ---------------------------------------------------------------- */
  /*  Проверки СБ: история событий и создание новых                    */
  /* ---------------------------------------------------------------- */

  /** GET /api/references/suppliers/:id/security-checks — история событий по поставщику */
  fastify.get<{ Params: IdParams }>(
    '/:id/security-checks',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin', 'user', 'security')] },
    async (request, reply) => {
      const { id } = request.params;
      const { data, error } = await request.server.supabase
        .from('supplier_security_checks')
        .select('id, supplier_id, author_id, event_type, comment, created_at, users(full_name)')
        .eq('supplier_id', id)
        .order('created_at', { ascending: false });
      if (error) return reply.status(500).send({ error: error.message });
      const items = (data ?? []).map((row: Record<string, unknown>) => {
        const author = row.users as { full_name?: string } | null;
        return {
          id: row.id,
          supplierId: row.supplier_id,
          authorId: row.author_id,
          authorFullName: author?.full_name ?? '',
          eventType: row.event_type,
          comment: row.comment,
          createdAt: row.created_at,
        };
      });
      return items;
    }
  );

  /** POST /api/references/suppliers/:id/security-checks/request — отправка на проверку (admin/user) */
  fastify.post<{ Params: IdParams }>(
    '/:id/security-checks/request',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request, reply) => {
      const user = request.user!;
      const { id: supplierId } = request.params;
      const supabase = request.server.supabase;

      // Проверяем существование поставщика
      const { data: sup, error: supErr } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('id', supplierId)
        .single();
      if (supErr || !sup) return reply.status(404).send({ error: 'Поставщик не найден' });

      // Защита от дубликата: последнее событие — открытый requested
      const { data: lastEvent } = await supabase
        .from('supplier_security_checks')
        .select('event_type')
        .eq('supplier_id', supplierId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastEvent && lastEvent.event_type === 'requested') {
        return reply.status(409).send({ error: 'Поставщик уже на проверке' });
      }

      // Создаём событие requested
      const { data: created, error: insErr } = await supabase
        .from('supplier_security_checks')
        .insert({ supplier_id: supplierId, author_id: user.id, event_type: 'requested', comment: null })
        .select('id, supplier_id, author_id, event_type, comment, created_at')
        .single();
      if (insErr) return reply.status(400).send({ error: insErr.message });

      // Создаём уведомления для всех активных пользователей с ролью security
      const { data: sbUsers } = await supabase
        .from('users')
        .select('id')
        .eq('role', 'security')
        .eq('is_active', true);
      if (sbUsers && sbUsers.length > 0) {
        const notifications = sbUsers.map((u: { id: string }) => ({
          type: 'sb_review_requested',
          title: 'Новый запрос на проверку поставщика',
          message: `${user.fullName} отправил поставщика «${sup.name}» на проверку СБ`,
          user_id: u.id,
          supplier_id: supplierId,
        }));
        await supabase.from('notifications').insert(notifications);
      }

      return reply.send(created);
    }
  );

  /** POST /api/references/suppliers/:id/security-checks/decision — решение СБ (security) */
  fastify.post<{ Params: IdParams; Body: SbDecisionBody }>(
    '/:id/security-checks/decision',
    { schema: { ...idParamsSchema, ...sbDecisionSchema }, preHandler: [authenticate, requireRole('security')] },
    async (request, reply) => {
      const user = request.user!;
      const { id: supplierId } = request.params;
      const { decision, comment } = request.body;
      const supabase = request.server.supabase;

      // Валидация: при rejected комментарий обязателен (минимум 3 символа)
      if (decision === 'rejected') {
        if (!comment || comment.trim().length < 3) {
          return reply.status(400).send({ error: 'Комментарий обязателен при отклонении (минимум 3 символа)' });
        }
      }

      // Проверяем существование поставщика
      const { data: sup, error: supErr } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('id', supplierId)
        .single();
      if (supErr || !sup) return reply.status(404).send({ error: 'Поставщик не найден' });

      // Находим инициаторов запросов, по которым ещё нет решения — для обратного уведомления
      const { data: lastDecision } = await supabase
        .from('supplier_security_checks')
        .select('created_at')
        .eq('supplier_id', supplierId)
        .in('event_type', ['approved', 'rejected'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let openRequests: { author_id: string }[] = [];
      if (lastDecision?.created_at) {
        const { data: rs } = await supabase
          .from('supplier_security_checks')
          .select('author_id')
          .eq('supplier_id', supplierId)
          .eq('event_type', 'requested')
          .gt('created_at', lastDecision.created_at);
        openRequests = rs ?? [];
      } else {
        const { data: rs } = await supabase
          .from('supplier_security_checks')
          .select('author_id')
          .eq('supplier_id', supplierId)
          .eq('event_type', 'requested');
        openRequests = rs ?? [];
      }

      // Создаём событие решения
      const { data: created, error: insErr } = await supabase
        .from('supplier_security_checks')
        .insert({
          supplier_id: supplierId,
          author_id: user.id,
          event_type: decision,
          comment: comment?.trim() || null,
        })
        .select('id, supplier_id, author_id, event_type, comment, created_at')
        .single();
      if (insErr) return reply.status(400).send({ error: insErr.message });

      // Уведомляем уникальных инициаторов запросов
      const initiatorIds = Array.from(new Set(openRequests.map((r) => r.author_id))).filter((uid) => uid !== user.id);
      if (initiatorIds.length > 0) {
        const decisionLabel = decision === 'approved' ? 'согласован' : 'отклонён';
        const notifications = initiatorIds.map((uid) => ({
          type: 'sb_review_decided',
          title: 'Решение по проверке поставщика',
          message: `Поставщик «${sup.name}» ${decisionLabel} отделом СБ`,
          user_id: uid,
          supplier_id: supplierId,
        }));
        await supabase.from('notifications').insert(notifications);
      }

      return reply.send(created);
    }
  );
}

export default supplierRoutes;
