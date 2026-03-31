import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов назначений                                        */
/* ------------------------------------------------------------------ */

async function assignmentRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };
  const anyAuthenticated = { preHandler: [authenticate, requireRole('admin', 'user', 'counterparty_user')] };

  const ASSIGNMENT_SELECT = `
    id, payment_request_id, assigned_user_id, assigned_by_user_id, assigned_at, is_current, created_at,
    assigned_user:users!payment_request_assignments_assigned_user_id_fkey(email, full_name),
    assigned_by_user:users!payment_request_assignments_assigned_by_user_id_fkey(email)
  `;

  /** Разворачивает вложенные join-объекты в плоские поля */
  function flattenAssignment(row: Record<string, unknown>): Record<string, unknown> {
    const assignedUser = row.assigned_user as Record<string, unknown> | null;
    const assignedByUser = row.assigned_by_user as Record<string, unknown> | null;
    const flat = { ...row };
    delete flat.assigned_user;
    delete flat.assigned_by_user;
    flat.assigned_user_email = assignedUser?.email ?? null;
    flat.assigned_user_full_name = assignedUser?.full_name ?? null;
    flat.assigned_by_user_email = assignedByUser?.email ?? null;
    return flat;
  }

  /* ---------- GET /api/assignments/payment-request/:requestId/current ---------- */
  fastify.get('/api/assignments/payment-request/:requestId/current', anyAuthenticated, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const supabase = fastify.supabase;

    const { data: current } = await supabase
      .from('payment_request_assignments')
      .select(ASSIGNMENT_SELECT)
      .eq('payment_request_id', requestId)
      .eq('is_current', true)
      .maybeSingle();

    return reply.send(current ? flattenAssignment(current as Record<string, unknown>) : null);
  });

  /* ---------- GET /api/assignments/payment-request/:requestId ---------- */
  fastify.get('/api/assignments/payment-request/:requestId', anyAuthenticated, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const supabase = fastify.supabase;

    const { data: history, error } = await supabase
      .from('payment_request_assignments')
      .select(ASSIGNMENT_SELECT)
      .eq('payment_request_id', requestId)
      .order('assigned_at', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send((history ?? []).map((row: Record<string, unknown>) => flattenAssignment(row)));
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

    return reply.send(data ?? []);
  });
}

export default assignmentRoutes;
