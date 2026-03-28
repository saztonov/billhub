import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов логов ошибок                                      */
/* ------------------------------------------------------------------ */

async function errorLogRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: [authenticate, requireRole('admin')] };
  const auth = { preHandler: [authenticate] };

  /* ---------- GET /api/error-logs ---------- */
  fastify.get('/api/error-logs', adminOnly, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const supabase = fastify.supabase;

    const page = parseInt(query.page ?? '1', 10);
    const pageSize = parseInt(query.pageSize ?? '20', 10);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = supabase
      .from('error_logs')
      .select('*, users!error_logs_user_id_fkey(email)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    // Фильтр по типу ошибки
    if (query.errorTypes) {
      const types = query.errorTypes.split(',');
      q = q.in('error_type', types);
    }

    // Фильтр по дате
    if (query.dateFrom) {
      q = q.gte('created_at', query.dateFrom);
    }
    if (query.dateTo) {
      q = q.lte('created_at', query.dateTo + 'T23:59:59.999Z');
    }

    const { data, error, count } = await q;
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ data: data ?? [], total: count ?? 0 });
  });

  /* ---------- POST /api/error-logs ---------- */
  fastify.post('/api/error-logs', auth, async (request, reply) => {
    const user = request.user!;
    const body = request.body as {
      errorType: string;
      errorMessage: string;
      errorStack?: string | null;
      url?: string | null;
      userAgent?: string | null;
      component?: string | null;
      metadata?: Record<string, unknown> | null;
    };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('error_logs')
      .insert({
        error_type: body.errorType,
        error_message: body.errorMessage,
        error_stack: body.errorStack || null,
        url: body.url || null,
        user_id: user.id,
        user_agent: body.userAgent || null,
        component: body.component || null,
        metadata: body.metadata || null,
      });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.status(201).send({ success: true });
  });

  /* ---------- DELETE /api/error-logs/bulk ---------- */
  fastify.delete('/api/error-logs/bulk', adminOnly, async (request, reply) => {
    const body = request.body as { olderThanDays: number };
    const supabase = fastify.supabase;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - body.olderThanDays);

    const { error } = await supabase
      .from('error_logs')
      .delete()
      .lt('created_at', cutoffDate.toISOString());
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });
}

export default fp(errorLogRoutes, { name: 'error-log-routes' });
