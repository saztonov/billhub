/**
 * Unit-тесты SupabaseOmtsRpRepository (Phase 8b) на FakeSupabase.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseOmtsRpRepository } from './omts-rp.supabase.js';

function setup() {
  const fake = new FakeSupabase();
  const repo = new SupabaseOmtsRpRepository(fake as unknown as SupabaseClient);
  return { fake, repo };
}

describe('SupabaseOmtsRpRepository', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('getResponsibleUserId: значение из omts_rp_config; null если ключа нет', async () => {
    s.fake.seed('settings', [{ key: 'omts_rp_config', value: { responsible_user_id: 'u7' } }]);
    expect(await s.repo.getResponsibleUserId()).toBe('u7');
    const empty = setup();
    expect(await empty.repo.getResponsibleUserId()).toBeNull();
  });

  it('setResponsibleUserId обновляет omts_rp_config', async () => {
    s.fake.seed('settings', [{ key: 'omts_rp_config', value: { responsible_user_id: null } }]);
    await s.repo.setResponsibleUserId('u9');
    const row = s.fake.tableRows('settings')[0]!;
    expect((row.value as { responsible_user_id: string }).responsible_user_id).toBe('u9');
  });

  it('updateSites add добавляет; повтор add — без изменений; remove удаляет', async () => {
    s.fake.seed('settings', [{ key: 'omts_rp_sites', value: { site_ids: ['s1'] } }]);
    await s.repo.updateSites('add', 's2');
    expect((s.fake.tableRows('settings')[0]!.value as { site_ids: string[] }).site_ids).toEqual([
      's1',
      's2',
    ]);
    await s.repo.updateSites('add', 's2'); // повтор — без изменений
    expect((s.fake.tableRows('settings')[0]!.value as { site_ids: string[] }).site_ids).toEqual([
      's1',
      's2',
    ]);
    await s.repo.updateSites('remove', 's1');
    expect((s.fake.tableRows('settings')[0]!.value as { site_ids: string[] }).site_ids).toEqual([
      's2',
    ]);
  });

  it('getSites: пустой site_ids → []; иначе объекты по id', async () => {
    s.fake.seed('settings', [{ key: 'omts_rp_sites', value: { site_ids: [] } }]);
    expect(await s.repo.getSites()).toEqual([]);

    const s2 = setup();
    s2.fake.seed('settings', [{ key: 'omts_rp_sites', value: { site_ids: ['a', 'b'] } }]);
    s2.fake.seed('construction_sites', [
      { id: 'a', name: 'Объект A' },
      { id: 'b', name: 'Объект B' },
      { id: 'c', name: 'Объект C' },
    ]);
    const res = await s2.repo.getSites();
    expect(res.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
});
