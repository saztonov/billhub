import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов комментариев                                      */
/* ------------------------------------------------------------------ */

async function commentRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticate] };

  /* ================================================================ */
  /*  Комментарии к заявкам на оплату (payment_request_comments)       */
  /* ================================================================ */

  /* ---------- GET /api/comments/payment-request/:requestId ---------- */
  fastify.get('/api/comments/payment-request/:requestId', auth, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('payment_request_comments')
      .select('id, payment_request_id, author_id, text, created_at, updated_at, recipient, author:users!payment_request_comments_author_id_fkey(full_name, email, role, department_id, counterparty:counterparties!users_counterparty_id_fkey(name))')
      .eq('payment_request_id', requestId)
      .order('created_at', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ data: data ?? [] });
  });

  /* ---------- POST /api/comments/payment-request ---------- */
  fastify.post('/api/comments/payment-request', auth, async (request, reply) => {
    const user = request.user!;
    const body = request.body as {
      paymentRequestId: string;
      text: string;
      recipient?: string | null;
    };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('payment_request_comments')
      .insert({
        payment_request_id: body.paymentRequestId,
        author_id: user.id,
        text: body.text,
        recipient: body.recipient || null,
      });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.status(201).send({ success: true });
  });

  /* ---------- PUT /api/comments/:id ---------- */
  fastify.put('/api/comments/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { text: string };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('payment_request_comments')
      .update({ text: body.text, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- DELETE /api/comments/:id ---------- */
  fastify.delete('/api/comments/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('payment_request_comments')
      .delete()
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- POST /api/comments/payment-request/:requestId/mark-read ---------- */
  fastify.post('/api/comments/payment-request/:requestId/mark-read', auth, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const user = request.user!;
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('comment_read_status')
      .upsert(
        { user_id: user.id, payment_request_id: requestId, last_read_at: new Date().toISOString() },
        { onConflict: 'user_id,payment_request_id' }
      );
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- GET /api/comments/payment-request/unread-counts ---------- */
  fastify.get('/api/comments/payment-request/unread-counts', auth, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;

    // Все комментарии (не от текущего пользователя)
    const { data: comments, error: cErr } = await supabase
      .from('payment_request_comments')
      .select('payment_request_id, created_at')
      .neq('author_id', user.id);
    if (cErr) return reply.status(500).send({ error: cErr.message });

    // Статусы прочтения
    const { data: readStatuses, error: rErr } = await supabase
      .from('comment_read_status')
      .select('payment_request_id, last_read_at')
      .eq('user_id', user.id);
    if (rErr) return reply.status(500).send({ error: rErr.message });

    const readMap: Record<string, string> = {};
    for (const rs of readStatuses ?? []) {
      readMap[(rs as Record<string, unknown>).payment_request_id as string] = (rs as Record<string, unknown>).last_read_at as string;
    }

    const counts: Record<string, number> = {};
    for (const c of comments ?? []) {
      const row = c as Record<string, unknown>;
      const prId = row.payment_request_id as string;
      const lastRead = readMap[prId];
      if (!lastRead || new Date(row.created_at as string) > new Date(lastRead)) {
        counts[prId] = (counts[prId] || 0) + 1;
      }
    }

    return reply.send({ data: counts });
  });

  /* ================================================================ */
  /*  Комментарии к заявкам на договор (contract_request_comments)     */
  /* ================================================================ */

  /* ---------- GET /api/comments/contract-request/:requestId ---------- */
  fastify.get('/api/comments/contract-request/:requestId', auth, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('contract_request_comments')
      .select('id, contract_request_id, author_id, text, created_at, updated_at, recipient, author:users!contract_request_comments_author_id_fkey(full_name, email, role, department_id, counterparty:counterparties!users_counterparty_id_fkey(name))')
      .eq('contract_request_id', requestId)
      .order('created_at', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ data: data ?? [] });
  });

  /* ---------- POST /api/comments/contract-request ---------- */
  fastify.post('/api/comments/contract-request', auth, async (request, reply) => {
    const user = request.user!;
    const body = request.body as {
      contractRequestId: string;
      text: string;
      recipient?: string | null;
    };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('contract_request_comments')
      .insert({
        contract_request_id: body.contractRequestId,
        author_id: user.id,
        text: body.text,
        recipient: body.recipient || null,
      });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.status(201).send({ success: true });
  });

  /* ---------- PUT /api/comments/contract-request/:id ---------- */
  fastify.put('/api/comments/contract-request/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { text: string };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('contract_request_comments')
      .update({ text: body.text, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- DELETE /api/comments/contract-request/:id ---------- */
  fastify.delete('/api/comments/contract-request/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('contract_request_comments')
      .delete()
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- POST /api/comments/contract-request/:requestId/mark-read ---------- */
  fastify.post('/api/comments/contract-request/:requestId/mark-read', auth, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const user = request.user!;
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('contract_comment_read_status')
      .upsert(
        { user_id: user.id, contract_request_id: requestId, last_read_at: new Date().toISOString() },
        { onConflict: 'user_id,contract_request_id' }
      );
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- GET /api/comments/contract-request/unread-counts ---------- */
  fastify.get('/api/comments/contract-request/unread-counts', auth, async (request, reply) => {
    const user = request.user!;
    const supabase = fastify.supabase;

    const { data: comments, error: cErr } = await supabase
      .from('contract_request_comments')
      .select('contract_request_id, created_at')
      .neq('author_id', user.id);
    if (cErr) return reply.status(500).send({ error: cErr.message });

    const { data: readStatuses, error: rErr } = await supabase
      .from('contract_comment_read_status')
      .select('contract_request_id, last_read_at')
      .eq('user_id', user.id);
    if (rErr) return reply.status(500).send({ error: rErr.message });

    const readMap: Record<string, string> = {};
    for (const rs of readStatuses ?? []) {
      readMap[(rs as Record<string, unknown>).contract_request_id as string] = (rs as Record<string, unknown>).last_read_at as string;
    }

    const counts: Record<string, number> = {};
    for (const c of comments ?? []) {
      const row = c as Record<string, unknown>;
      const crId = row.contract_request_id as string;
      const lastRead = readMap[crId];
      if (!lastRead || new Date(row.created_at as string) > new Date(lastRead)) {
        counts[crId] = (counts[crId] || 0) + 1;
      }
    }

    return reply.send({ data: counts });
  });
}

export default fp(commentRoutes, { name: 'comment-routes' });
