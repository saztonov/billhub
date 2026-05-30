/**
 * Unit-тесты Supabase-репозиториев Iteration 5 (Phase 2):
 *  - field-options (расширение SupabaseReferenceRepository);
 *  - SupabaseNotificationRepository (listUnread с именами связанных сущностей, count, mark-read).
 * Работают на FakeSupabase (in-memory), без Docker.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseReferenceRepository } from './reference.supabase.js';
import { SupabaseNotificationRepository } from './notification.supabase.js';
import { NotFoundError } from '../types.js';

function setup() {
  const fake = new FakeSupabase();
  const client = fake as unknown as SupabaseClient;
  return {
    fake,
    references: new SupabaseReferenceRepository(client),
    notifications: new SupabaseNotificationRepository(client),
  };
}

describe('SupabaseReferenceRepository — field options', () => {
  let r: ReturnType<typeof setup>;
  beforeEach(() => {
    r = setup();
  });

  it('create + list (фильтр fieldCode) + update + delete', async () => {
    const a = await r.references.createFieldOption({ fieldCode: 'payment_type', value: 'Аванс' });
    expect(a.fieldCode).toBe('payment_type');
    expect(a.isActive).toBe(true);
    await r.references.createFieldOption({ fieldCode: 'other', value: 'X' });

    expect((await r.references.listFieldOptions()).length).toBe(2);
    expect((await r.references.listFieldOptions('payment_type')).length).toBe(1);

    const upd = await r.references.updateFieldOption(a.id, { value: 'Аванс2', displayOrder: 3 });
    expect(upd.value).toBe('Аванс2');
    expect(upd.displayOrder).toBe(3);

    await r.references.deleteFieldOption(a.id);
    expect((await r.references.listFieldOptions()).length).toBe(1);
    await expect(r.references.deleteFieldOption(a.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('update несуществующей опции → NotFoundError', async () => {
    await expect(r.references.updateFieldOption('missing', { value: 'X' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('SupabaseNotificationRepository', () => {
  let r: ReturnType<typeof setup>;
  beforeEach(() => {
    r = setup();
    r.fake.seed('construction_sites', [{ id: 'site1', name: 'Объект А' }]);
    r.fake.seed('payment_requests', [{ id: 'pr1', request_number: 'PR-001' }]);
    r.fake.seed('suppliers', [{ id: 'sup1', name: 'Поставщик П' }]);
    r.fake.seed('notifications', [
      {
        id: 'n1',
        type: 'sb_review_requested',
        title: 'T1',
        message: 'M1',
        user_id: 'u1',
        is_read: false,
        payment_request_id: 'pr1',
        contract_request_id: null,
        supplier_id: 'sup1',
        department_id: null,
        site_id: 'site1',
        resolved: false,
        resolved_at: null,
        created_at: '2026-05-01T00:00:00.000Z',
      },
      {
        id: 'n2',
        type: 'info',
        title: 'T2',
        message: 'M2',
        user_id: 'u1',
        is_read: true,
        payment_request_id: null,
        contract_request_id: null,
        supplier_id: null,
        department_id: null,
        site_id: null,
        resolved: false,
        resolved_at: null,
        created_at: '2026-05-02T00:00:00.000Z',
      },
      {
        id: 'n3',
        type: 'info',
        title: 'T3',
        message: 'M3',
        user_id: 'other',
        is_read: false,
        payment_request_id: null,
        contract_request_id: null,
        supplier_id: null,
        department_id: null,
        site_id: null,
        resolved: false,
        resolved_at: null,
        created_at: '2026-05-03T00:00:00.000Z',
      },
    ]);
  });

  it('listUnread возвращает только непрочитанные пользователя с именами связанных сущностей', async () => {
    const list = await r.notifications.listUnread('u1');
    expect(list.length).toBe(1);
    expect(list[0]!.id).toBe('n1');
    expect(list[0]!.siteName).toBe('Объект А');
    expect(list[0]!.requestNumber).toBe('PR-001');
    expect(list[0]!.supplierName).toBe('Поставщик П');
    expect(list[0]!.contractRequestNumber).toBeNull();
  });

  it('countUnread считает только непрочитанные пользователя', async () => {
    expect(await r.notifications.countUnread('u1')).toBe(1);
    expect(await r.notifications.countUnread('other')).toBe(1);
  });

  it('markRead убирает уведомление из непрочитанных', async () => {
    await r.notifications.markRead('n1');
    expect(await r.notifications.countUnread('u1')).toBe(0);
  });

  it('markAllRead помечает все уведомления пользователя', async () => {
    r.fake.seed('notifications', [
      {
        id: 'a',
        type: 'info',
        title: 't',
        message: 'm',
        user_id: 'u1',
        is_read: false,
        payment_request_id: null,
        contract_request_id: null,
        supplier_id: null,
        department_id: null,
        site_id: null,
        resolved: false,
        resolved_at: null,
        created_at: '2026-05-01T00:00:00.000Z',
      },
      {
        id: 'b',
        type: 'info',
        title: 't',
        message: 'm',
        user_id: 'u1',
        is_read: false,
        payment_request_id: null,
        contract_request_id: null,
        supplier_id: null,
        department_id: null,
        site_id: null,
        resolved: false,
        resolved_at: null,
        created_at: '2026-05-01T00:00:00.000Z',
      },
    ]);
    expect(await r.notifications.countUnread('u1')).toBe(2);
    await r.notifications.markAllRead('u1');
    expect(await r.notifications.countUnread('u1')).toBe(0);
  });
});
