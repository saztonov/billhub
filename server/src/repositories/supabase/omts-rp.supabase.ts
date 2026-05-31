/**
 * SupabaseOmtsRpRepository — rollback-провайдер настроек ОМТС-РП (Iteration 5).
 * Дословный порт routes/omts-rp.ts (без эндпоинта omts-users — он переиспользует assignments).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OmtsRpRepository, Row } from '../omts-rp.repository.js';

export class SupabaseOmtsRpRepository implements OmtsRpRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getResponsibleUserId(): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('settings')
      .select('value')
      .eq('key', 'omts_rp_config')
      .single();
    if (error || !data) return null;
    return ((data.value as Row).responsible_user_id as string | null) ?? null;
  }

  async getSites(): Promise<Row[]> {
    const { data, error } = await this.supabase
      .from('settings')
      .select('value')
      .eq('key', 'omts_rp_sites')
      .single();
    if (error) throw new Error(error.message);

    const siteIds = ((data.value as Row).site_ids as string[]) ?? [];
    if (siteIds.length === 0) return [];

    const { data: sitesData, error: sitesErr } = await this.supabase
      .from('construction_sites')
      .select('id, name')
      .in('id', siteIds);
    if (sitesErr) throw new Error(sitesErr.message);
    return sitesData ?? [];
  }

  async updateSites(action: 'add' | 'remove', siteId: string): Promise<void> {
    const { data, error: readErr } = await this.supabase
      .from('settings')
      .select('value')
      .eq('key', 'omts_rp_sites')
      .single();
    if (readErr) throw new Error(readErr.message);

    const current = ((data.value as Row).site_ids as string[]) ?? [];
    let updated: string[];
    if (action === 'add') {
      if (current.includes(siteId)) return;
      updated = [...current, siteId];
    } else {
      updated = current.filter((id) => id !== siteId);
    }

    const { error } = await this.supabase
      .from('settings')
      .update({ value: { site_ids: updated }, updated_at: new Date().toISOString() })
      .eq('key', 'omts_rp_sites');
    if (error) throw new Error(error.message);
  }

  async setResponsibleUserId(userId: string | null): Promise<void> {
    const { error } = await this.supabase
      .from('settings')
      .update({
        value: { responsible_user_id: userId },
        updated_at: new Date().toISOString(),
      })
      .eq('key', 'omts_rp_config');
    if (error) throw new Error(error.message);
  }
}
