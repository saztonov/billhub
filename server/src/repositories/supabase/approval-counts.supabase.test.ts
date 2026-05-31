/**
 * Unit-тесты счётчиков SupabaseApprovalRepository и error-log deleteOlderThan (Phase 8 финал).
 * Эти методы используют простые select-фильтры (.not/.is/.lt) без вложенных join — тестируемы
 * на FakeSupabase (списки с PR_SELECT остаются интеграционными).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseApprovalRepository } from './approval.supabase.js';
import { SupabaseErrorLogRepository } from './error-log.supabase.js';

describe('SupabaseApprovalRepository — счётчики (query-scope, без join)', () => {
  let fake: FakeSupabase;
  let repo: SupabaseApprovalRepository;
  beforeEach(() => {
    fake = new FakeSupabase();
    repo = new SupabaseApprovalRepository(fake as unknown as SupabaseClient);
    fake.seed('payment_requests', [
      {
        id: 'p1',
        approved_at: '2026-02-01T00:00:00Z',
        rejected_at: null,
        closed_at: null,
        is_deleted: false,
        site_id: 's1',
      },
      {
        id: 'p2',
        approved_at: '2026-02-02T00:00:00Z',
        rejected_at: null,
        closed_at: '2026-03-01T00:00:00Z',
        is_deleted: false,
        site_id: 's1',
      },
      {
        id: 'p3',
        approved_at: null,
        rejected_at: '2026-02-03T00:00:00Z',
        closed_at: null,
        is_deleted: false,
        site_id: 's2',
      },
      {
        id: 'p4',
        approved_at: '2026-02-04T00:00:00Z',
        rejected_at: null,
        closed_at: null,
        is_deleted: true,
        site_id: 's1',
      },
    ]);
    fake.seed('users', [{ id: 'admin1', all_sites: true }]);
  });

  it('countApproved: approved_at not null + не удалённые', async () => {
    expect(await repo.countApproved({ allSites: true, siteIds: [] })).toBe(2); // p1, p2 (p4 удалена)
  });

  it('countRejected: rejected_at not null + не удалённые', async () => {
    expect(await repo.countRejected({ allSites: true, siteIds: [] })).toBe(1); // p3
  });

  it('countAll: все не удалённые', async () => {
    expect(await repo.countAll({ allSites: true, siteIds: [] })).toBe(3); // p1,p2,p3
  });

  it('countApproved с siteIds фильтрует по объекту', async () => {
    expect(await repo.countApproved({ allSites: false, siteIds: ['s1'] })).toBe(2); // p1,p2
    expect(await repo.countApproved({ allSites: false, siteIds: [] })).toBe(0); // нет sites → 0
  });

  it('countReadyForClosure: approved + closed_at null + не удалённые (site-scope из all_sites)', async () => {
    expect(await repo.countReadyForClosure({ userId: 'admin1' })).toBe(1); // p1 (p2 закрыта)
  });
});

describe('SupabaseErrorLogRepository.deleteOlderThan', () => {
  it('удаляет записи старше cutoff (created_at < cutoff)', async () => {
    const fake = new FakeSupabase();
    fake.seed('error_logs', [
      { id: 'e1', created_at: '2026-01-01T00:00:00Z' },
      { id: 'e2', created_at: '2026-06-01T00:00:00Z' },
    ]);
    const repo = new SupabaseErrorLogRepository(fake as unknown as SupabaseClient);
    await repo.deleteOlderThan('2026-03-01T00:00:00Z');
    expect(fake.tableRows('error_logs').map((r) => r.id)).toEqual(['e2']);
  });
});
