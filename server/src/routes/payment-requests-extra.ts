import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Дополнительные маршруты заявок на оплату                           */
/*  (эндпоинты, ожидаемые фронтендом)                                  */
/* ------------------------------------------------------------------ */

async function paymentRequestExtraRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticate] };
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /* ---------- PATCH /api/payment-requests/:id/status ---------- */
  /** Обновить статус заявки */
  fastify.patch('/api/payment-requests/:id/status', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { statusId: string };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('payment_requests')
      .update({ status_id: body.statusId })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- PATCH /api/payment-requests/:id/dp ---------- */
  /** Обновить данные РП */
  fastify.patch('/api/payment-requests/:id/dp', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      dpNumber: string;
      dpDate: string;
      dpAmount: number;
      dpFileKey: string;
      dpFileName: string;
    };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('payment_requests')
      .update({
        dp_number: body.dpNumber,
        dp_date: body.dpDate,
        dp_amount: body.dpAmount,
        dp_file_key: body.dpFileKey,
        dp_file_name: body.dpFileName,
      })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- PATCH /api/payment-requests/files/:fileId/rejection ---------- */
  /** Переключить отклонение файла (по fileId в URL) */
  fastify.patch('/api/payment-requests/files/:fileId/rejection', adminOrUser, async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    const body = request.body as { isRejected: boolean; userId: string };
    const supabase = fastify.supabase;

    const updateData = body.isRejected
      ? { is_rejected: true, rejected_by: body.userId, rejected_at: new Date().toISOString() }
      : { is_rejected: false, rejected_by: null, rejected_at: null };

    const { error } = await supabase
      .from('payment_request_files')
      .update(updateData)
      .eq('id', fileId);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true, isRejected: body.isRejected });
  });

  /* ---------- POST /api/payment-requests/:id/files ---------- */
  /** Сохранить метаданные файла заявки (вызывается из uploadQueueStore) */
  fastify.post('/api/payment-requests/:id/files', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      documentTypeId: string;
      fileName: string;
      fileKey: string;
      fileSize: number;
      mimeType: string | null;
      pageCount: number | null;
      userId: string;
      isResubmit: boolean;
      isAdditional: boolean;
    };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('payment_request_files')
      .insert({
        payment_request_id: id,
        document_type_id: body.documentTypeId,
        file_name: body.fileName,
        file_key: body.fileKey,
        file_size: body.fileSize,
        mime_type: body.mimeType,
        page_count: body.pageCount,
        created_by: body.userId,
        is_resubmit: body.isResubmit ?? false,
        is_additional: body.isAdditional ?? false,
      });
    if (error) return reply.status(500).send({ error: error.message });

    // Увеличиваем uploaded_files
    await supabase.rpc('increment_uploaded_files', { request_id: id });

    return reply.status(201).send({ success: true });
  });

  /* ---------- GET /api/payment-requests/:id/number ---------- */
  /** Получить номер заявки (для OCR-очереди) */
  fastify.get('/api/payment-requests/:id/number', auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('payment_requests')
      .select('request_number')
      .eq('id', id)
      .single();
    if (error) return reply.status(404).send({ error: 'Заявка не найдена' });

    return reply.send({ requestNumber: data.request_number });
  });
}

export default paymentRequestExtraRoutes;
