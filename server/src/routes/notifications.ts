import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов уведомлений                                       */
/* ------------------------------------------------------------------ */

async function notificationRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticate] };

  /* ---------- GET /api/notifications ---------- */
  fastify.get('/api/notifications', auth, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('notifications')
      .select(`
        id, type, title, message, user_id, is_read, payment_request_id,
        contract_request_id, department_id, site_id, resolved, resolved_at, created_at,
        construction_sites(name),
        payment_requests(request_number),
        contract_requests(request_number)
      `)
      .eq('user_id', user.id)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ data: data ?? [] });
  });

  /* ---------- GET /api/notifications/count ---------- */
  fastify.get('/api/notifications/count', auth, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;

    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ count: count ?? 0 });
  });

  /* ---------- POST /api/notifications/:id/mark-read ---------- */
  fastify.post('/api/notifications/:id/mark-read', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- POST /api/notifications/mark-all-read ---------- */
  fastify.post('/api/notifications/mark-all-read', auth, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });
}

export default notificationRoutes;
