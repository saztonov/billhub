/**
 * SupabaseOcrRepository — rollback-провайдер OCR (БД-часть, Iteration 5).
 * Дословный порт DB-логики routes/ocr.ts. Очередь/OpenRouter/SSE остались в роуте.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OcrRepository, OcrSettings, OcrTokenStat, Row } from '../ocr.repository.js';
import type { OcrPricingModelBody } from '../../schemas/ocr.js';

export class SupabaseOcrRepository implements OcrRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async paymentRequestExists(paymentRequestId: string): Promise<boolean> {
    const { data: pr, error } = await this.supabase
      .from('payment_requests')
      .select('id')
      .eq('id', paymentRequestId)
      .single();
    return !(error || !pr);
  }

  async getSettings(): Promise<OcrSettings> {
    const { data, error } = await this.supabase
      .from('settings')
      .select('key, value')
      .in('key', ['ocr_auto_enabled', 'ocr_active_model_id', 'ocr_models']);
    if (error) throw new Error(error.message);

    const settings: Record<string, unknown> = {};
    for (const row of data ?? []) settings[row.key as string] = row.value;

    const autoVal = settings['ocr_auto_enabled'] as { enabled?: boolean } | undefined;
    const modelVal = settings['ocr_active_model_id'] as { modelId?: string } | undefined;
    const modelsVal = settings['ocr_models'] as { models?: unknown[] } | undefined;

    return {
      autoEnabled: autoVal?.enabled ?? false,
      activeModelId: modelVal?.modelId ?? '',
      models: modelsVal?.models ?? [],
    };
  }

  async setAutoEnabled(enabled: boolean): Promise<void> {
    const { error } = await this.supabase
      .from('settings')
      .upsert({ key: 'ocr_auto_enabled', value: { enabled } }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
  }

  async setActiveModel(modelId: string): Promise<void> {
    const { error } = await this.supabase
      .from('settings')
      .upsert({ key: 'ocr_active_model_id', value: { modelId } }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
  }

  private async readModels(): Promise<Record<string, unknown>[]> {
    const { data } = await this.supabase
      .from('settings')
      .select('value')
      .eq('key', 'ocr_models')
      .single();
    return ((data?.value as { models?: Record<string, unknown>[] } | null)?.models ?? []) as Record<
      string,
      unknown
    >[];
  }

  private async writeModels(models: unknown[]): Promise<void> {
    const { error } = await this.supabase
      .from('settings')
      .upsert({ key: 'ocr_models', value: { models } }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
  }

  async addModel(model: OcrPricingModelBody): Promise<void> {
    const current = await this.readModels();
    await this.writeModels([...current, model]);
  }

  async updateModel(id: string, partial: Record<string, unknown>): Promise<void> {
    const current = await this.readModels();
    await this.writeModels(current.map((m) => (m.id === id ? { ...m, ...partial } : m)));
  }

  async deleteModel(id: string): Promise<void> {
    const current = await this.readModels();
    await this.writeModels(current.filter((m) => m.id !== id));
  }

  async listApprovedRequests(): Promise<Row[]> {
    const { data: statusData, error: statusErr } = await this.supabase
      .from('statuses')
      .select('id')
      .eq('entity_type', 'payment_request')
      .eq('code', 'approved')
      .single();
    if (statusErr || !statusData) return [];

    const { data: requests, error: reqErr } = await this.supabase
      .from('payment_requests')
      .select('id, request_number, invoice_amount, counterparties(name), construction_sites(name)')
      .eq('status_id', statusData.id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });
    if (reqErr) throw new Error(reqErr.message);

    const prIds = (requests ?? []).map((r: Row) => r.id as string);
    let recognizedSet = new Set<string>();
    if (prIds.length > 0) {
      const { data: matData } = await this.supabase
        .from('recognized_materials')
        .select('payment_request_id')
        .in('payment_request_id', prIds);
      recognizedSet = new Set((matData ?? []).map((r: Row) => r.payment_request_id as string));
    }

    return (requests ?? []).map((row: Row) => {
      const cp = row.counterparties as Row | null;
      const site = row.construction_sites as Row | null;
      return {
        id: row.id,
        requestNumber: row.request_number,
        counterpartyName: cp?.name ?? '',
        siteName: site?.name ?? '',
        invoiceAmount: row.invoice_amount ?? null,
        recognized: recognizedSet.has(row.id as string),
      };
    });
  }

  async listLogs(page: number, pageSize: number): Promise<{ logs: Row[]; total: number }> {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { count, error: countErr } = await this.supabase
      .from('ocr_recognition_log')
      .select('id', { count: 'exact', head: true });
    if (countErr) throw new Error(countErr.message);

    const { data, error } = await this.supabase
      .from('ocr_recognition_log')
      .select(
        'id, payment_request_id, file_id, model_id, status, error_message, attempt_number, input_tokens, output_tokens, total_cost, started_at, completed_at',
      )
      .order('started_at', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);

    const prIds = [...new Set((data ?? []).map((r: Row) => r.payment_request_id as string))];
    const prMap: Record<string, string> = {};
    if (prIds.length > 0) {
      const { data: prData } = await this.supabase
        .from('payment_requests')
        .select('id, request_number')
        .in('id', prIds);
      for (const row of prData ?? []) {
        const r = row as Row;
        prMap[r.id as string] = r.request_number as string;
      }
    }

    const logs = (data ?? []).map((row: Row) => ({
      id: row.id,
      paymentRequestId: row.payment_request_id,
      requestNumber: prMap[row.payment_request_id as string] ?? '',
      fileId: row.file_id,
      modelId: row.model_id,
      status: row.status,
      errorMessage: row.error_message,
      attemptNumber: row.attempt_number,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalCost: row.total_cost,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    }));

    return { logs, total: count ?? 0 };
  }

  async getTokenStats(): Promise<Record<string, OcrTokenStat>> {
    const { data, error } = await this.supabase
      .from('ocr_recognition_log')
      .select('model_id, input_tokens, output_tokens, total_cost')
      .eq('status', 'success');
    if (error) throw new Error(error.message);

    const stats: Record<string, OcrTokenStat> = {};
    for (const row of data ?? []) {
      const r = row as Row;
      const modelId = r.model_id as string;
      if (!stats[modelId]) stats[modelId] = { inputTokens: 0, outputTokens: 0, totalCost: 0 };
      const entry = stats[modelId]!;
      entry.inputTokens += Number(r.input_tokens ?? 0);
      entry.outputTokens += Number(r.output_tokens ?? 0);
      entry.totalCost += Number(r.total_cost ?? 0);
    }
    return stats;
  }
}
