import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов назначений                                        */
/* ------------------------------------------------------------------ */

async function assignmentRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /* ---------- GET /api/assignments/payment-request/:requestId/current ---------- */
  /** Получить только текущее назначение (фронтенд вызывает с /current) */
  fastify.get('/api/assignments/payment-request/:requestId/current', adminOrUser, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const supabase = fastify.supabase;

    const { data: current } = await supabase
      .from('payment_request_assignments')
      .select(`
        id, payment_request_id, assigned_user_id, assigned_by_user_id, assigned_at, is_current, created_at,
        assigned_user:users!payment_request_assignments_assigned_user_id_fkey(email, full_name),
        assigned_by_user:users!payment_request_assignments_assigned_by_user_id_fkey(email)
      `)
      .eq('payment_request_id', requestId)
      .eq('is_current', true)
      .maybeSingle();

    return reply.send(current ?? null);
  });

  /* ---------- GET /api/assignments/payment-request/:requestId ---------- */
  fastify.get('/api/assignments/payment-request/:requestId', adminOrUser, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const supabase = fastify.supabase;

    // История назначений
    const { data: history, error } = await supabase
      .from('payment_request_assignments')
      .select(`
        id, payment_request_id, assigned_user_id, assigned_by_user_id, assigned_at, is_current, created_at,
        assigned_user:users!payment_request_assignments_assigned_user_id_fkey(email, full_name),
        assigned_by_user:users!payment_request_assignments_assigned_by_user_id_fkey(email)
      `)
      .eq('payment_request_id', requestId)
      .order('assigned_at', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send(history ?? []);
  });

  /* ---------- POST /api/assignments ---------- */
  fastify.post('/api/assignments', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const body = request.body as {
      paymentRequestId: string;
      assignedUserId: string;
    };
    const supabase = fastify.supabase;

    // Снимаем текущее назначение
    await supabase
      .from('payment_request_assignments')
      .update({ is_current: false })
      .eq('payment_request_id', body.paymentRequestId)
      .eq('is_current', true);

    // Создаём новое назначение
    const { error } = await supabase
      .from('payment_request_assignments')
      .insert({
        payment_request_id: body.paymentRequestId,
        assigned_user_id: body.assignedUserId,
        assigned_by_user_id: user.id,
        is_current: true,
      });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.status(201).send({ success: true });
  });

  /* ---------- GET /api/assignments/omts-users ---------- */
  fastify.get('/api/assignments/omts-users', adminOrUser, async (_request, reply) => {
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name')
      .eq('department_id', 'omts')
      .eq('is_active', true)
      .in('role', ['admin', 'user'])
      .order('full_name', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ data: data ?? [] });
  });
}

export default assignmentRoutes;
