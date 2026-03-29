import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Вспомогательные функции                                            */
/* ------------------------------------------------------------------ */

/** Пересчёт paid_status заявки */
async function recalcPaidStatus(
  supabase: FastifyInstance['supabase'],
  paymentRequestId: string
): Promise<void> {
  // Считаем сумму исполненных оплат
  const { data: paymentsData, error: pErr } = await supabase
    .from('payment_payments')
    .select('amount')
    .eq('payment_request_id', paymentRequestId)
    .eq('is_executed', true);
  if (pErr) throw pErr;

  const totalPaid = (paymentsData ?? []).reduce(
    (sum, p) => sum + Number((p as Record<string, unknown>).amount ?? 0),
    0
  );

  // Получаем invoice_amount
  const { data: reqData, error: rErr } = await supabase
    .from('payment_requests')
    .select('invoice_amount')
    .eq('id', paymentRequestId)
    .single();
  if (rErr) throw rErr;

  const invoiceAmount = Number(reqData.invoice_amount) || 0;

  // Определяем статус оплаты
  let statusCode = 'not_paid';
  if (totalPaid > 0 && totalPaid < invoiceAmount) statusCode = 'partially_paid';
  else if (totalPaid > 0 && totalPaid >= invoiceAmount) statusCode = 'paid';

  const { data: statusData, error: sErr } = await supabase
    .from('statuses')
    .select('id')
    .eq('entity_type', 'paid')
    .eq('code', statusCode)
    .single();
  if (sErr) throw sErr;

  await supabase
    .from('payment_requests')
    .update({ total_paid: totalPaid, paid_status_id: statusData.id })
    .eq('id', paymentRequestId);
}

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов оплат                                             */
/* ------------------------------------------------------------------ */

async function paymentRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /* ---------- GET /api/payments/payment-request/:requestId ---------- */
  fastify.get('/api/payments/payment-request/:requestId', adminOrUser, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('payment_payments')
      .select('id, payment_request_id, payment_number, payment_date, amount, is_executed, created_by, updated_by, created_at, updated_at, payment_payment_files(id, payment_payment_id, file_name, file_key, file_size, mime_type, created_by, created_at)')
      .eq('payment_request_id', requestId)
      .order('payment_number', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ data: data ?? [] });
  });

  /* ---------- GET /api/payments/:paymentRequestId ---------- */
  /** Алиас: фронтенд вызывает GET /api/payments/:paymentRequestId */
  fastify.get('/api/payments/:paymentRequestId', adminOrUser, async (request, reply) => {
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('payment_payments')
      .select('id, payment_request_id, payment_number, payment_date, amount, is_executed, created_by, updated_by, created_at, updated_at, payment_payment_files(id, payment_payment_id, file_name, file_key, file_size, mime_type, created_by, created_at)')
      .eq('payment_request_id', paymentRequestId)
      .order('payment_number', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ data: data ?? [] });
  });

  /* ---------- POST /api/payments/:paymentRequestId ---------- */
  /** Алиас: фронтенд вызывает POST /api/payments/:paymentRequestId */
  fastify.post('/api/payments/:paymentRequestId', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    const body = request.body as {
      paymentDate: string;
      amount: number;
    };
    const supabase = fastify.supabase;

    // Определяем следующий номер оплаты
    const { data: maxData } = await supabase
      .from('payment_payments')
      .select('payment_number')
      .eq('payment_request_id', paymentRequestId)
      .order('payment_number', { ascending: false })
      .limit(1);

    const nextNumber = (maxData && maxData.length > 0)
      ? (maxData[0] as Record<string, unknown>).payment_number as number + 1
      : 1;

    const { data: inserted, error } = await supabase
      .from('payment_payments')
      .insert({
        payment_request_id: paymentRequestId,
        payment_number: nextNumber,
        payment_date: body.paymentDate,
        amount: body.amount,
        created_by: user.id,
      })
      .select('id')
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    await recalcPaidStatus(supabase, paymentRequestId);

    return reply.status(201).send({ data: { id: inserted.id } });
  });

  /* ---------- POST /api/payments ---------- */
  fastify.post('/api/payments', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const body = request.body as {
      paymentRequestId: string;
      paymentDate: string;
      amount: number;
    };
    const supabase = fastify.supabase;

    // Определяем следующий номер оплаты
    const { data: maxData } = await supabase
      .from('payment_payments')
      .select('payment_number')
      .eq('payment_request_id', body.paymentRequestId)
      .order('payment_number', { ascending: false })
      .limit(1);

    const nextNumber = (maxData && maxData.length > 0)
      ? (maxData[0] as Record<string, unknown>).payment_number as number + 1
      : 1;

    const { data: inserted, error } = await supabase
      .from('payment_payments')
      .insert({
        payment_request_id: body.paymentRequestId,
        payment_number: nextNumber,
        payment_date: body.paymentDate,
        amount: body.amount,
        created_by: user.id,
      })
      .select('id')
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    await recalcPaidStatus(supabase, body.paymentRequestId);

    return reply.status(201).send({ data: { id: inserted.id } });
  });

  /* ---------- PUT /api/payments/:id ---------- */
  fastify.put('/api/payments/:id', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = request.body as {
      paymentDate?: string;
      amount?: number;
    };
    const supabase = fastify.supabase;

    const updates: Record<string, unknown> = {
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    if (body.paymentDate !== undefined) updates.payment_date = body.paymentDate;
    if (body.amount !== undefined) updates.amount = body.amount;

    const { error } = await supabase
      .from('payment_payments')
      .update(updates)
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    // Получаем payment_request_id для пересчёта
    const { data: payment } = await supabase
      .from('payment_payments')
      .select('payment_request_id')
      .eq('id', id)
      .single();
    if (payment) {
      await recalcPaidStatus(supabase, payment.payment_request_id as string);
    }

    return reply.send({ success: true });
  });

  /* ---------- DELETE /api/payments/:id ---------- */
  fastify.delete('/api/payments/:id', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supabase = fastify.supabase;

    // Получаем payment_request_id до удаления
    const { data: payment, error: fetchErr } = await supabase
      .from('payment_payments')
      .select('payment_request_id')
      .eq('id', id)
      .single();
    if (fetchErr) return reply.status(404).send({ error: 'Оплата не найдена' });

    // Удаляем оплату (файлы каскадно удалятся из БД)
    const { error } = await supabase
      .from('payment_payments')
      .delete()
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    await recalcPaidStatus(supabase, payment.payment_request_id as string);

    return reply.send({ success: true });
  });

  /* ---------- POST /api/payments/:id/files ---------- */
  fastify.post('/api/payments/:id/files', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = request.body as {
      fileName: string;
      fileKey: string;
      fileSize: number | null;
      mimeType: string | null;
    };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('payment_payment_files')
      .insert({
        payment_payment_id: id,
        file_name: body.fileName,
        file_key: body.fileKey,
        file_size: body.fileSize,
        mime_type: body.mimeType,
        created_by: user.id,
      });
    if (error) return reply.status(500).send({ error: error.message });

    // Помечаем оплату как исполненную
    await supabase
      .from('payment_payments')
      .update({ is_executed: true })
      .eq('id', id);

    // Пересчитываем статус
    const { data: payment } = await supabase
      .from('payment_payments')
      .select('payment_request_id')
      .eq('id', id)
      .single();
    if (payment) {
      await recalcPaidStatus(supabase, payment.payment_request_id as string);
    }

    return reply.status(201).send({ success: true });
  });

  /* ---------- PUT /api/payments/item/:id ---------- */
  /** Алиас: фронтенд вызывает PUT /api/payments/item/:id */
  fastify.put('/api/payments/item/:id', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = request.body as {
      paymentDate?: string;
      amount?: number;
    };
    const supabase = fastify.supabase;

    const updates: Record<string, unknown> = {
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    if (body.paymentDate !== undefined) updates.payment_date = body.paymentDate;
    if (body.amount !== undefined) updates.amount = body.amount;

    const { error } = await supabase
      .from('payment_payments')
      .update(updates)
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    const { data: payment } = await supabase
      .from('payment_payments')
      .select('payment_request_id')
      .eq('id', id)
      .single();
    if (payment) {
      await recalcPaidStatus(supabase, payment.payment_request_id as string);
    }

    return reply.send({ success: true });
  });

  /* ---------- DELETE /api/payments/item/:id ---------- */
  /** Алиас: фронтенд вызывает DELETE /api/payments/item/:id */
  fastify.delete('/api/payments/item/:id', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supabase = fastify.supabase;

    const { data: payment, error: fetchErr } = await supabase
      .from('payment_payments')
      .select('payment_request_id')
      .eq('id', id)
      .single();
    if (fetchErr) return reply.status(404).send({ error: 'Оплата не найдена' });

    const { error } = await supabase
      .from('payment_payments')
      .delete()
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    await recalcPaidStatus(supabase, payment.payment_request_id as string);

    return reply.send({ success: true });
  });

  /* ---------- POST /api/payments/item/:paymentId/files ---------- */
  /** Алиас: фронтенд вызывает POST /api/payments/item/:paymentId/files */
  fastify.post('/api/payments/item/:paymentId/files', adminOrUser, async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string };
    const user = request.user!;
    const body = request.body as {
      fileName: string;
      fileKey: string;
      fileSize: number | null;
      mimeType: string | null;
    };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('payment_payment_files')
      .insert({
        payment_payment_id: paymentId,
        file_name: body.fileName,
        file_key: body.fileKey,
        file_size: body.fileSize,
        mime_type: body.mimeType,
        created_by: user.id,
      });
    if (error) return reply.status(500).send({ error: error.message });

    // Помечаем оплату как исполненную
    await supabase
      .from('payment_payments')
      .update({ is_executed: true })
      .eq('id', paymentId);

    // Пересчитываем статус
    const { data: payment } = await supabase
      .from('payment_payments')
      .select('payment_request_id')
      .eq('id', paymentId)
      .single();
    if (payment) {
      await recalcPaidStatus(supabase, payment.payment_request_id as string);
    }

    return reply.status(201).send({ success: true });
  });

  /* ---------- POST /api/payments/:paymentRequestId/recalc-status ---------- */
  /** Пересчёт статуса оплаты заявки */
  fastify.post('/api/payments/:paymentRequestId/recalc-status', adminOrUser, async (request, reply) => {
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    const supabase = fastify.supabase;

    await recalcPaidStatus(supabase, paymentRequestId);

    // Возвращаем обновлённые значения
    const { data: reqData, error: rErr } = await supabase
      .from('payment_requests')
      .select('total_paid, paid_status_id')
      .eq('id', paymentRequestId)
      .single();
    if (rErr) return reply.status(500).send({ error: rErr.message });

    return reply.send({
      totalPaid: Number(reqData.total_paid) || 0,
      paidStatusId: reqData.paid_status_id as string,
    });
  });

  /* ---------- DELETE /api/payments/files/:id ---------- */
  fastify.delete('/api/payments/files/:id', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { paymentId?: string };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('payment_payment_files')
      .delete()
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    // Пересчитываем is_executed
    if (query.paymentId) {
      const { data: remainingFiles } = await supabase
        .from('payment_payment_files')
        .select('id')
        .eq('payment_payment_id', query.paymentId)
        .limit(1);
      const hasFiles = (remainingFiles ?? []).length > 0;

      await supabase
        .from('payment_payments')
        .update({ is_executed: hasFiles })
        .eq('id', query.paymentId);

      // Пересчитываем total_paid
      const { data: payment } = await supabase
        .from('payment_payments')
        .select('payment_request_id')
        .eq('id', query.paymentId)
        .single();
      if (payment) {
        await recalcPaidStatus(supabase, payment.payment_request_id as string);
      }
    }

    return reply.send({ success: true });
  });
}

export default paymentRoutes;
