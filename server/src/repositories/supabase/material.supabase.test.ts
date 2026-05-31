/**
 * Unit-тесты SupabaseMaterialRepository (Phase 8c) на FakeSupabase.
 * Покрывают updateEstimate; read/aggregation-методы (embeds, inner-join, gte/lte) — интеграционно.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseMaterialRepository } from './material.supabase.js';

describe('SupabaseMaterialRepository.updateEstimate', () => {
  it('обновляет estimate_quantity по id (число и null)', async () => {
    const fake = new FakeSupabase();
    fake.seed('recognized_materials', [{ id: 'm1', position: 1, estimate_quantity: null }]);
    const repo = new SupabaseMaterialRepository(fake as unknown as SupabaseClient);

    await repo.updateEstimate('m1', 12.5);
    expect(fake.tableRows('recognized_materials')[0]!.estimate_quantity).toBe(12.5);

    await repo.updateEstimate('m1', null);
    expect(fake.tableRows('recognized_materials')[0]!.estimate_quantity).toBeNull();
  });
});
