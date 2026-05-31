/**
 * Unit-тесты SupabaseOcrRepository (Phase 8e) на FakeSupabase (с поддержкой upsert).
 * listApprovedRequests/listLogs (embeds/range) — интеграционно.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseOcrRepository } from './ocr.supabase.js';

function setup() {
  const fake = new FakeSupabase();
  const repo = new SupabaseOcrRepository(fake as unknown as SupabaseClient);
  return { fake, repo };
}

describe('SupabaseOcrRepository — paymentRequestExists', () => {
  it('true если заявка есть, иначе false', async () => {
    const { fake, repo } = setup();
    fake.seed('payment_requests', [{ id: 'pr1' }]);
    expect(await repo.paymentRequestExists('pr1')).toBe(true);
    expect(await repo.paymentRequestExists('nope')).toBe(false);
  });
});

describe('SupabaseOcrRepository — settings', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('getSettings собирает auto/active/models с дефолтами', async () => {
    s.fake.seed('settings', [
      { key: 'ocr_auto_enabled', value: { enabled: true } },
      { key: 'ocr_active_model_id', value: { modelId: 'm-1' } },
    ]);
    const res = await s.repo.getSettings();
    expect(res).toEqual({ autoEnabled: true, activeModelId: 'm-1', models: [] });
  });

  it('setAutoEnabled/setActiveModel: upsert (создаёт и обновляет)', async () => {
    await s.repo.setAutoEnabled(true);
    expect(
      (
        s.fake.tableRows('settings').find((r) => r.key === 'ocr_auto_enabled')!.value as {
          enabled: boolean;
        }
      ).enabled,
    ).toBe(true);
    await s.repo.setAutoEnabled(false);
    expect(
      (
        s.fake.tableRows('settings').find((r) => r.key === 'ocr_auto_enabled')!.value as {
          enabled: boolean;
        }
      ).enabled,
    ).toBe(false);
    expect(s.fake.tableRows('settings').filter((r) => r.key === 'ocr_auto_enabled').length).toBe(1);

    await s.repo.setActiveModel('m-9');
    expect(
      (
        s.fake.tableRows('settings').find((r) => r.key === 'ocr_active_model_id')!.value as {
          modelId: string;
        }
      ).modelId,
    ).toBe('m-9');
  });

  it('add/update/deleteModel модифицируют settings.ocr_models.models[]', async () => {
    const readModels = (): { id: string; name?: string }[] =>
      (
        s.fake.tableRows('settings').find((r) => r.key === 'ocr_models')!.value as {
          models: { id: string; name?: string }[];
        }
      ).models;

    await s.repo.addModel({ id: 'a', name: 'A', inputPrice: 1, outputPrice: 2 });
    await s.repo.addModel({ id: 'b', name: 'B', inputPrice: 3, outputPrice: 4 });
    expect(readModels().map((m) => m.id)).toEqual(['a', 'b']);

    await s.repo.updateModel('a', { name: 'A2' });
    expect(readModels().find((m) => m.id === 'a')!.name).toBe('A2');

    await s.repo.deleteModel('b');
    expect(readModels().map((m) => m.id)).toEqual(['a']);
  });
});

describe('SupabaseOcrRepository — getTokenStats', () => {
  it('агрегирует по model_id только успешные', async () => {
    const { fake, repo } = setup();
    fake.seed('ocr_recognition_log', [
      {
        id: 'l1',
        model_id: 'm1',
        status: 'success',
        input_tokens: 100,
        output_tokens: 50,
        total_cost: '0.10',
      },
      {
        id: 'l2',
        model_id: 'm1',
        status: 'success',
        input_tokens: 200,
        output_tokens: 70,
        total_cost: '0.20',
      },
      {
        id: 'l3',
        model_id: 'm2',
        status: 'success',
        input_tokens: 10,
        output_tokens: 5,
        total_cost: '0.01',
      },
      {
        id: 'l4',
        model_id: 'm1',
        status: 'failed',
        input_tokens: 999,
        output_tokens: 999,
        total_cost: '9.99',
      },
    ]);
    const res = await repo.getTokenStats();
    expect(res.m1).toEqual({ inputTokens: 300, outputTokens: 120, totalCost: 0.30000000000000004 });
    expect(res.m2).toEqual({ inputTokens: 10, outputTokens: 5, totalCost: 0.01 });
  });
});
