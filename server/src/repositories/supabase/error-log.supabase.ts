/**
 * SupabaseErrorLogRepository — rollback-провайдер логов ошибок (Iteration 5).
 * Дословный порт routes/error-logs.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ErrorLogRepository, ErrorLogListFilter, Row } from '../error-log.repository.js';
import type { CreateErrorLogBody } from '../../schemas/error-log.js';

export class SupabaseErrorLogRepository implements ErrorLogRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async list(filter: ErrorLogListFilter): Promise<{ data: Row[]; total: number }> {
    const from = (filter.page - 1) * filter.pageSize;
    const to = from + filter.pageSize - 1;

    let q = this.supabase
      .from('error_logs')
      .select('*, users!error_logs_user_id_fkey(email)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (filter.errorTypes && filter.errorTypes.length > 0) {
      q = q.in('error_type', filter.errorTypes);
    }
    if (filter.dateFrom) q = q.gte('created_at', filter.dateFrom);
    if (filter.dateTo) q = q.lte('created_at', filter.dateTo + 'T23:59:59.999Z');

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return { data: data ?? [], total: count ?? 0 };
  }

  async create(input: CreateErrorLogBody & { userId: string }): Promise<void> {
    const { error } = await this.supabase.from('error_logs').insert({
      error_type: input.errorType,
      error_message: input.errorMessage,
      error_stack: input.errorStack || null,
      url: input.url || null,
      user_id: input.userId,
      user_agent: input.userAgent || null,
      component: input.component || null,
      metadata: input.metadata || null,
    });
    if (error) throw new Error(error.message);
  }

  async deleteOlderThan(cutoffIso: string): Promise<void> {
    const { error } = await this.supabase.from('error_logs').delete().lt('created_at', cutoffIso);
    if (error) throw new Error(error.message);
  }
}
