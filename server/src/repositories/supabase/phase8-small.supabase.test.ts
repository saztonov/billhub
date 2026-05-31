/**
 * Unit-тесты Supabase-репозиториев Phase 8a на FakeSupabase:
 * assignments (create + omts-users), ocr-models (CRUD + setActive), error-logs (create).
 * Списки с join/range/date-фильтрами (assignment current/history, error-logs list) — интеграционно.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseAssignmentRepository } from './assignment.supabase.js';
import { SupabaseOcrModelRepository } from './ocr-model.supabase.js';
import { SupabaseErrorLogRepository } from './error-log.supabase.js';

function client(fake: FakeSupabase) {
  return fake as unknown as SupabaseClient;
}

describe('SupabaseAssignmentRepository', () => {
  let fake: FakeSupabase;
  let repo: SupabaseAssignmentRepository;
  beforeEach(() => {
    fake = new FakeSupabase();
    repo = new SupabaseAssignmentRepository(client(fake));
  });

  it('create: снимает текущее назначение и вставляет новое is_current=true', async () => {
    fake.seed('payment_request_assignments', [
      { id: 'a1', payment_request_id: 'pr1', assigned_user_id: 'u-old', is_current: true },
    ]);
    await repo.create({
      paymentRequestId: 'pr1',
      assignedUserId: 'u-new',
      assignedByUserId: 'admin',
    });
    const rows = fake.tableRows('payment_request_assignments');
    expect(rows.find((r) => r.id === 'a1')!.is_current).toBe(false);
    const fresh = rows.find((r) => r.assigned_user_id === 'u-new')!;
    expect(fresh.is_current).toBe(true);
    expect(fresh.assigned_by_user_id).toBe('admin');
  });

  it('listOmtsUsers: только omts + активные + роль admin|user', async () => {
    fake.seed('users', [
      {
        id: 'u1',
        email: 'a@x',
        full_name: 'Анна',
        department_id: 'omts',
        is_active: true,
        role: 'user',
      },
      {
        id: 'u2',
        email: 'b@x',
        full_name: 'Борис',
        department_id: 'omts',
        is_active: false,
        role: 'user',
      },
      {
        id: 'u3',
        email: 'c@x',
        full_name: 'Вера',
        department_id: 'shtab',
        is_active: true,
        role: 'user',
      },
      {
        id: 'u4',
        email: 'd@x',
        full_name: 'Глеб',
        department_id: 'omts',
        is_active: true,
        role: 'counterparty_user',
      },
    ]);
    const res = await repo.listOmtsUsers();
    expect(res.map((u) => u.id)).toEqual(['u1']);
  });
});

describe('SupabaseOcrModelRepository (колонка name)', () => {
  let fake: FakeSupabase;
  let repo: SupabaseOcrModelRepository;
  beforeEach(() => {
    fake = new FakeSupabase();
    repo = new SupabaseOcrModelRepository(client(fake));
  });

  it('create: пишет name+model_id, is_active по умолчанию false; возвращает строку', async () => {
    const created = await repo.create({ name: 'GPT-4o', modelId: 'openai/gpt-4o' });
    expect(created.name).toBe('GPT-4o');
    expect(created.model_id).toBe('openai/gpt-4o');
    expect(created.is_active).toBe(false);
    expect(fake.tableRows('ocr_models').length).toBe(1);
  });

  it('delete удаляет по id', async () => {
    fake.seed('ocr_models', [{ id: 'm1', name: 'M', model_id: 'x', is_active: false }]);
    await repo.delete('m1');
    expect(fake.tableRows('ocr_models').length).toBe(0);
  });

  it('setActive: деактивирует все, активирует одну; возвращает активированную', async () => {
    fake.seed('ocr_models', [
      { id: 'm1', name: 'A', model_id: 'a', is_active: true },
      { id: 'm2', name: 'B', model_id: 'b', is_active: false },
    ]);
    const res = await repo.setActive('m2');
    expect(res.id).toBe('m2');
    expect(res.is_active).toBe(true);
    const rows = fake.tableRows('ocr_models');
    expect(rows.find((r) => r.id === 'm1')!.is_active).toBe(false);
    expect(rows.find((r) => r.id === 'm2')!.is_active).toBe(true);
  });

  it('list упорядочен по created_at desc', async () => {
    fake.seed('ocr_models', [
      { id: 'm1', name: 'A', model_id: 'a', is_active: false, created_at: '2026-01-01T00:00:00Z' },
      { id: 'm2', name: 'B', model_id: 'b', is_active: false, created_at: '2026-02-01T00:00:00Z' },
    ]);
    const res = await repo.list();
    expect(res.map((m) => m.id)).toEqual(['m2', 'm1']);
  });
});

describe('SupabaseErrorLogRepository', () => {
  it('create пишет поля + user_id', async () => {
    const fake = new FakeSupabase();
    const repo = new SupabaseErrorLogRepository(client(fake));
    await repo.create({
      errorType: 'TypeError',
      errorMessage: 'boom',
      userId: 'u1',
      component: 'App',
    });
    const row = fake.tableRows('error_logs')[0]!;
    expect(row.error_type).toBe('TypeError');
    expect(row.error_message).toBe('boom');
    expect(row.user_id).toBe('u1');
    expect(row.component).toBe('App');
    expect(row.error_stack).toBeNull();
  });
});
