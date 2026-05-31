/**
 * SupabaseMaterialRepository — rollback-провайдер материалов (Iteration 5).
 * Дословный порт routes/materials.ts (embeds + JS-агрегация).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MaterialRepository, MaterialFilter, Row } from '../material.repository.js';

/** ID типа документа "Счет" */
const INVOICE_DOC_TYPE_ID = 'c3c0b242-8a0c-4e20-b9ad-363ebf462a5b';

function flattenRecognizedMaterial(row: Row): Row {
  const mat = row.materials_dictionary as Row | null;
  const flat = { ...row };
  delete flat.materials_dictionary;
  flat.material_name = mat?.name ?? null;
  flat.material_unit = mat?.unit ?? null;
  return flat;
}

export class SupabaseMaterialRepository implements MaterialRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getRequestInfo(paymentRequestId: string): Promise<Row | null> {
    const { data, error } = await this.supabase
      .from('payment_requests')
      .select(
        'request_number, approved_at, cost_type_id, materials_verification, counterparties(name), suppliers(name), construction_sites(name), cost_types(name)',
      )
      .eq('id', paymentRequestId)
      .single();
    if (error) return null;

    const cp = data.counterparties as unknown as Row | null;
    const sup = data.suppliers as unknown as Row | null;
    const site = data.construction_sites as unknown as Row | null;
    const ct = data.cost_types as unknown as Row | null;

    return {
      request_number: data.request_number,
      counterparty_name: cp?.name ?? null,
      supplier_name: sup?.name ?? null,
      site_name: site?.name ?? null,
      approved_at: data.approved_at,
      cost_type_id: data.cost_type_id,
      cost_type_name: ct?.name ?? null,
      materials_verification: data.materials_verification,
    };
  }

  async listDictionary(): Promise<Row[]> {
    const { data, error } = await this.supabase
      .from('materials_dictionary')
      .select('id, name, unit')
      .order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async listRequests(): Promise<Row[]> {
    const { data: matData, error: matErr } = await this.supabase
      .from('recognized_materials')
      .select('payment_request_id');
    if (matErr) throw new Error(matErr.message);

    const uniqueIds = [...new Set((matData ?? []).map((r: Row) => r.payment_request_id as string))];
    if (uniqueIds.length === 0) return [];

    const countMap: Record<string, { count: number; total: number }> = {};
    for (const row of matData ?? []) {
      const id = (row as Row).payment_request_id as string;
      if (!countMap[id]) countMap[id] = { count: 0, total: 0 };
      countMap[id].count++;
    }

    const { data: amountData } = await this.supabase
      .from('recognized_materials')
      .select('payment_request_id, amount')
      .in('payment_request_id', uniqueIds);
    for (const row of amountData ?? []) {
      const r = row as Row;
      const id = r.payment_request_id as string;
      if (countMap[id]) countMap[id].total += Number(r.amount ?? 0);
    }

    const { data: filesData } = await this.supabase
      .from('payment_request_files')
      .select('payment_request_id')
      .in('payment_request_id', uniqueIds)
      .eq('document_type_id', INVOICE_DOC_TYPE_ID);

    const invoicesCountMap: Record<string, number> = {};
    for (const row of filesData ?? []) {
      const id = (row as Row).payment_request_id as string;
      invoicesCountMap[id] = (invoicesCountMap[id] ?? 0) + 1;
    }

    const { data: prData, error: prErr } = await this.supabase
      .from('payment_requests')
      .select(
        'id, request_number, approved_at, materials_verification, counterparties(name), suppliers(name), construction_sites(name)',
      )
      .in('id', uniqueIds)
      .order('approved_at', { ascending: false });
    if (prErr) throw new Error(prErr.message);

    return (prData ?? []).map((row: Row) => {
      const id = row.id as string;
      const cp = row.counterparties as Row | null;
      const sup = row.suppliers as Row | null;
      const site = row.construction_sites as Row | null;
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
  }

  async listRecognized(paymentRequestId: string): Promise<Row[]> {
    const { data, error } = await this.supabase
      .from('recognized_materials')
      .select(
        'id, payment_request_id, file_id, material_id, page_number, position, article, quantity, price, amount, estimate_quantity, created_at, materials_dictionary(name, unit)',
      )
      .eq('payment_request_id', paymentRequestId)
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: Row) => flattenRecognizedMaterial(r));
  }

  async updateEstimate(id: string, estimateQuantity: number | null): Promise<void> {
    const { error } = await this.supabase
      .from('recognized_materials')
      .update({ estimate_quantity: estimateQuantity })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async getSummary(filter: MaterialFilter): Promise<Row[]> {
    let q = this.supabase
      .from('recognized_materials')
      .select(
        'material_id, quantity, price, amount, estimate_quantity, payment_requests!inner(counterparty_id, supplier_id, site_id, approved_at), materials_dictionary!inner(name, unit)',
      );

    if (filter.counterpartyId) q = q.eq('payment_requests.counterparty_id', filter.counterpartyId);
    if (filter.supplierId) q = q.eq('payment_requests.supplier_id', filter.supplierId);
    if (filter.siteId) q = q.eq('payment_requests.site_id', filter.siteId);
    if (filter.dateFrom) q = q.gte('payment_requests.approved_at', filter.dateFrom);
    if (filter.dateTo) q = q.lte('payment_requests.approved_at', filter.dateTo);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const grouped: Record<
      string,
      {
        materialId: string;
        materialName: string;
        materialUnit: string | null;
        totalQuantity: number;
        totalAmount: number;
        totalEstimateQuantity: number;
      }
    > = {};

    for (const row of data ?? []) {
      const r = row as Row;
      const matId = r.material_id as string;
      const mat = r.materials_dictionary as Row;
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
    return summary;
  }

  async getHierarchicalSummary(filter: MaterialFilter): Promise<Row[]> {
    let q = this.supabase
      .from('recognized_materials')
      .select(
        'material_id, quantity, price, amount, estimate_quantity, payment_requests!inner(counterparty_id, supplier_id, site_id, cost_type_id, approved_at, counterparties(name), construction_sites(name), cost_types(name)), materials_dictionary!inner(name, unit)',
      );

    if (filter.counterpartyId) q = q.eq('payment_requests.counterparty_id', filter.counterpartyId);
    if (filter.supplierId) q = q.eq('payment_requests.supplier_id', filter.supplierId);
    if (filter.siteId) q = q.eq('payment_requests.site_id', filter.siteId);
    if (filter.costTypeId) q = q.eq('payment_requests.cost_type_id', filter.costTypeId);
    if (filter.dateFrom) q = q.gte('payment_requests.approved_at', filter.dateFrom);
    if (filter.dateTo) q = q.lte('payment_requests.approved_at', filter.dateTo);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    return (data ?? []).map((row: Row) => {
      const pr = row.payment_requests as Row;
      const mat = row.materials_dictionary as Row;
      const cp = pr.counterparties as Row | null;
      const site = pr.construction_sites as Row | null;
      const ct = pr.cost_types as Row | null;
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
  }

  async listInvoiceFiles(paymentRequestId: string): Promise<Row[]> {
    const { data, error } = await this.supabase
      .from('payment_request_files')
      .select('id, file_key, file_name, mime_type')
      .eq('payment_request_id', paymentRequestId)
      .eq('document_type_id', INVOICE_DOC_TYPE_ID);
    if (error) throw new Error(error.message);
    return data ?? [];
  }
}
