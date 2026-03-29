import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Константы                                                          */
/* ------------------------------------------------------------------ */

/** ID типа документа "Счет" */
const INVOICE_DOC_TYPE_ID = 'c3c0b242-8a0c-4e20-b9ad-363ebf462a5b';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов материалов                                        */
/* ------------------------------------------------------------------ */

async function materialRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /* ---------- GET /api/materials/dictionary ---------- */
  fastify.get('/api/materials/dictionary', adminOrUser, async (_request, reply) => {
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('materials_dictionary')
      .select('id, name, unit')
      .order('name', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ data: data ?? [] });
  });

  /* ---------- GET /api/materials/requests ---------- */
  fastify.get('/api/materials/requests', adminOrUser, async (_request, reply) => {
    const supabase = fastify.supabase;

    // Получаем уникальные payment_request_id с распознанными материалами
    const { data: matData, error: matErr } = await supabase
      .from('recognized_materials')
      .select('payment_request_id');
    if (matErr) return reply.status(500).send({ error: matErr.message });

    const uniqueIds = [...new Set((matData ?? []).map((r: Record<string, unknown>) => r.payment_request_id as string))];
    if (uniqueIds.length === 0) return reply.send({ data: [] });

    // Подсчёт позиций и суммы
    const countMap: Record<string, { count: number; total: number }> = {};
    for (const row of matData ?? []) {
      const id = (row as Record<string, unknown>).payment_request_id as string;
      if (!countMap[id]) countMap[id] = { count: 0, total: 0 };
      countMap[id].count++;
    }

    const { data: amountData } = await supabase
      .from('recognized_materials')
      .select('payment_request_id, amount')
      .in('payment_request_id', uniqueIds);
    for (const row of amountData ?? []) {
      const r = row as Record<string, unknown>;
      const id = r.payment_request_id as string;
      if (countMap[id]) countMap[id].total += Number(r.amount ?? 0);
    }

    // Подсчёт файлов-счетов
    const { data: filesData } = await supabase
      .from('payment_request_files')
      .select('payment_request_id')
      .in('payment_request_id', uniqueIds)
      .eq('document_type_id', INVOICE_DOC_TYPE_ID);

    const invoicesCountMap: Record<string, number> = {};
    for (const row of filesData ?? []) {
      const id = (row as Record<string, unknown>).payment_request_id as string;
      invoicesCountMap[id] = (invoicesCountMap[id] ?? 0) + 1;
    }

    // Данные заявок
    const { data: prData, error: prErr } = await supabase
      .from('payment_requests')
      .select('id, request_number, approved_at, materials_verification, counterparties(name), suppliers(name), construction_sites(name)')
      .in('id', uniqueIds)
      .order('approved_at', { ascending: false });
    if (prErr) return reply.status(500).send({ error: prErr.message });

    const requests = (prData ?? []).map((row: Record<string, unknown>) => {
      const id = row.id as string;
      const cp = row.counterparties as Record<string, unknown> | null;
      const sup = row.suppliers as Record<string, unknown> | null;
      const site = row.construction_sites as Record<string, unknown> | null;
      return {
        paymentRequestId: id,
        requestNumber: row.request_number,
        counterpartyName: cp?.name ?? '',
        supplierName: sup?.name ?? '',
        approvedAt: row.approved_at,
        siteName: site?.name ?? '',
        itemsCount: countMap[id]?.count ?? 0,
        totalAmount: countMap[id]?.total ?? 0,
        invoicesCount: invoicesCountMap[id] ?? 0,
        materialsVerification: row.materials_verification ?? null,
      };
    });

    return reply.send({ data: requests });
  });

  /* ---------- GET /api/materials/recognized/:paymentRequestId ---------- */
  fastify.get('/api/materials/recognized/:paymentRequestId', adminOrUser, async (request, reply) => {
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('recognized_materials')
      .select('id, payment_request_id, file_id, material_id, page_number, position, article, quantity, price, amount, estimate_quantity, created_at, materials_dictionary(name, unit)')
      .eq('payment_request_id', paymentRequestId)
      .order('position', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ data: data ?? [] });
  });

  /* ---------- PUT /api/materials/recognized/:id ---------- */
  fastify.put('/api/materials/recognized/:id', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { estimateQuantity: number | null };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('recognized_materials')
      .update({ estimate_quantity: body.estimateQuantity })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- PATCH /api/materials/recognized/:id/estimate ---------- */
  /** Алиас: фронтенд вызывает PATCH с /estimate суффиксом */
  fastify.patch('/api/materials/recognized/:id/estimate', adminOrUser, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { estimateQuantity: number | null };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('recognized_materials')
      .update({ estimate_quantity: body.estimateQuantity })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- GET /api/materials/summary ---------- */
  fastify.get('/api/materials/summary', adminOrUser, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const supabase = fastify.supabase;

    let q = supabase
      .from('recognized_materials')
      .select('material_id, quantity, price, amount, estimate_quantity, payment_requests!inner(counterparty_id, supplier_id, site_id, approved_at), materials_dictionary!inner(name, unit)');

    if (query.counterpartyId) q = q.eq('payment_requests.counterparty_id', query.counterpartyId);
    if (query.supplierId) q = q.eq('payment_requests.supplier_id', query.supplierId);
    if (query.siteId) q = q.eq('payment_requests.site_id', query.siteId);
    if (query.dateFrom) q = q.gte('payment_requests.approved_at', query.dateFrom);
    if (query.dateTo) q = q.lte('payment_requests.approved_at', query.dateTo);

    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });

    // Группировка по material_id
    const grouped: Record<string, {
      materialId: string; materialName: string; materialUnit: string | null;
      totalQuantity: number; totalAmount: number; totalEstimateQuantity: number;
    }> = {};

    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      const matId = r.material_id as string;
      const mat = r.materials_dictionary as Record<string, unknown>;

      if (!grouped[matId]) {
        grouped[matId] = {
          materialId: matId,
          materialName: mat.name as string,
          materialUnit: mat.unit as string | null,
          totalQuantity: 0,
          totalAmount: 0,
          totalEstimateQuantity: 0,
        };
      }
      grouped[matId].totalQuantity += Number(r.quantity ?? 0);
      grouped[matId].totalAmount += Number(r.amount ?? 0);
      grouped[matId].totalEstimateQuantity += Number(r.estimate_quantity ?? 0);
    }

    const summary = Object.values(grouped).map((row) => ({
      ...row,
      averagePrice: row.totalQuantity > 0 ? row.totalAmount / row.totalQuantity : 0,
    }));

    summary.sort((a, b) => a.materialName.localeCompare(b.materialName, 'ru'));

    return reply.send({ data: summary });
  });

  /* ---------- GET /api/materials/hierarchical-summary ---------- */
  fastify.get('/api/materials/hierarchical-summary', adminOrUser, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const supabase = fastify.supabase;

    let q = supabase
      .from('recognized_materials')
      .select('material_id, quantity, price, amount, estimate_quantity, payment_requests!inner(counterparty_id, supplier_id, site_id, cost_type_id, approved_at, counterparties(name), construction_sites(name), cost_types(name)), materials_dictionary!inner(name, unit)');

    if (query.counterpartyId) q = q.eq('payment_requests.counterparty_id', query.counterpartyId);
    if (query.supplierId) q = q.eq('payment_requests.supplier_id', query.supplierId);
    if (query.siteId) q = q.eq('payment_requests.site_id', query.siteId);
    if (query.costTypeId) q = q.eq('payment_requests.cost_type_id', query.costTypeId);
    if (query.dateFrom) q = q.gte('payment_requests.approved_at', query.dateFrom);
    if (query.dateTo) q = q.lte('payment_requests.approved_at', query.dateTo);

    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: error.message });

    // Возвращаем сырые данные — клиент строит иерархию
    const rows = (data ?? []).map((row: Record<string, unknown>) => {
      const pr = row.payment_requests as Record<string, unknown>;
      const mat = row.materials_dictionary as Record<string, unknown>;
      const cp = pr.counterparties as Record<string, unknown> | null;
      const site = pr.construction_sites as Record<string, unknown> | null;
      const ct = pr.cost_types as Record<string, unknown> | null;

      return {
        materialId: row.material_id,
        materialName: mat.name,
        materialUnit: mat.unit,
        quantity: Number(row.quantity ?? 0),
        price: Number(row.price ?? 0),
        amount: Number(row.amount ?? 0),
        estimateQuantity: row.estimate_quantity != null ? Number(row.estimate_quantity) : null,
        costTypeId: pr.cost_type_id,
        costTypeName: ct?.name ?? null,
        siteId: pr.site_id,
        siteName: site?.name ?? '',
        counterpartyId: pr.counterparty_id,
        counterpartyName: cp?.name ?? '',
      };
    });

    return reply.send({ data: rows });
  });

  /* ---------- GET /api/materials/invoice-files/:paymentRequestId ---------- */
  fastify.get('/api/materials/invoice-files/:paymentRequestId', adminOrUser, async (request, reply) => {
    const { paymentRequestId } = request.params as { paymentRequestId: string };
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('payment_request_files')
      .select('id, file_key, file_name, mime_type')
      .eq('payment_request_id', paymentRequestId)
      .eq('document_type_id', INVOICE_DOC_TYPE_ID);
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ data: data ?? [] });
  });
}

export default materialRoutes;
