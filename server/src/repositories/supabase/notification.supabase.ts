/**
 * SupabaseRepository для уведомлений (Strangler Fig, rollback-инструмент).
 * Имена связанных сущностей подгружаются отдельными запросами (без PostgREST-вложенного join —
 * для совместимости и тестируемости на FakeSupabase).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationRepository } from '../notification.repository.js';
import type { NotificationDto } from '../../schemas/notification.js';

const FIELDS =
  'id, type, title, message, user_id, is_read, payment_request_id, contract_request_id, supplier_id, department_id, site_id, resolved, resolved_at, created_at';

interface NotifRow {
  id: string;
  type: string;
  title: string;
  message: string;
  user_id: string;
  is_read: boolean;
  payment_request_id: string | null;
  contract_request_id: string | null;
  supplier_id: string | null;
  department_id: string | null;
  site_id: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

function uniq(ids: (string | null)[]): string[] {
  return Array.from(new Set(ids.filter((x): x is string => !!x)));
}

export class SupabaseNotificationRepository implements NotificationRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listUnread(userId: string): Promise<NotificationDto[]> {
    const { data, error } = await this.supabase
      .from('notifications')
      .select(FIELDS)
      .eq('user_id', userId)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const rows = (data ?? []) as NotifRow[];
    if (rows.length === 0) return [];

    const siteIds = uniq(rows.map((r) => r.site_id));
    const prIds = uniq(rows.map((r) => r.payment_request_id));
    const crIds = uniq(rows.map((r) => r.contract_request_id));
    const supIds = uniq(rows.map((r) => r.supplier_id));

    const [sites, prs, crs, sups] = await Promise.all([
      siteIds.length
        ? this.supabase.from('construction_sites').select('id, name').in('id', siteIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      prIds.length
        ? this.supabase.from('payment_requests').select('id, request_number').in('id', prIds)
        : Promise.resolve({ data: [] as { id: string; request_number: string }[] }),
      crIds.length
        ? this.supabase.from('contract_requests').select('id, request_number').in('id', crIds)
        : Promise.resolve({ data: [] as { id: string; request_number: string }[] }),
      supIds.length
        ? this.supabase.from('suppliers').select('id, name').in('id', supIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);

    const siteName = new Map(
      ((sites.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
    );
    const prNum = new Map(
      ((prs.data ?? []) as { id: string; request_number: string }[]).map((p) => [
        p.id,
        p.request_number,
      ]),
    );
    const crNum = new Map(
      ((crs.data ?? []) as { id: string; request_number: string }[]).map((c) => [
        c.id,
        c.request_number,
      ]),
    );
    const supName = new Map(
      ((sups.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
    );

    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      message: r.message,
      userId: r.user_id,
      isRead: r.is_read,
      paymentRequestId: r.payment_request_id,
      contractRequestId: r.contract_request_id,
      supplierId: r.supplier_id,
      departmentId: r.department_id,
      siteId: r.site_id,
      resolved: r.resolved,
      resolvedAt: r.resolved_at,
      createdAt: r.created_at,
      siteName: r.site_id ? (siteName.get(r.site_id) ?? null) : null,
      requestNumber: r.payment_request_id ? (prNum.get(r.payment_request_id) ?? null) : null,
      contractRequestNumber: r.contract_request_id
        ? (crNum.get(r.contract_request_id) ?? null)
        : null,
      supplierName: r.supplier_id ? (supName.get(r.supplier_id) ?? null) : null,
    }));
  }

  async countUnread(userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    if (error) throw error;
    return count ?? 0;
  }

  async markRead(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id);
    if (error) throw error;
  }

  async markAllRead(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    if (error) throw error;
  }
}
