/**
 * Unit-тесты SupabaseCommentRepository (Phase 2) на FakeSupabase.
 * Покрывают: list с обогащением автором/контрагентом, create/update/delete,
 * mark-read (upsert) и unread-counts (payment + contract).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseCommentRepository } from './comment.supabase.js';

function setup() {
  const fake = new FakeSupabase();
  const repo = new SupabaseCommentRepository(fake as unknown as SupabaseClient);
  return { fake, repo };
}

describe('SupabaseCommentRepository — payment', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    s.fake.seed('users', [
      {
        id: 'u1',
        full_name: 'Иван',
        email: 'i@b.ru',
        role: 'user',
        department_id: 'omts',
        counterparty_id: null,
      },
      {
        id: 'u2',
        full_name: 'Подрядчик',
        email: 'p@b.ru',
        role: 'counterparty_user',
        department_id: null,
        counterparty_id: 'cp1',
      },
    ]);
    s.fake.seed('counterparties', [{ id: 'cp1', name: 'ООО Ромашка' }]);
  });

  it('create + list обогащает данными автора', async () => {
    await s.repo.createPaymentComment('u1', { paymentRequestId: 'pr1', text: 'Привет' });
    const list = await s.repo.listPaymentComments('pr1');
    expect(list.length).toBe(1);
    expect(list[0]!.paymentRequestId).toBe('pr1');
    expect(list[0]!.authorFullName).toBe('Иван');
    expect(list[0]!.authorEmail).toBe('i@b.ru');
    expect(list[0]!.authorRole).toBe('user');
    expect(list[0]!.authorDepartment).toBe('omts');
    expect(list[0]!.authorCounterpartyName).toBeNull();
  });

  it('list подставляет имя контрагента для автора-подрядчика', async () => {
    await s.repo.createPaymentComment('u2', { paymentRequestId: 'pr1', text: 'От подрядчика' });
    const list = await s.repo.listPaymentComments('pr1');
    expect(list[0]!.authorCounterpartyName).toBe('ООО Ромашка');
  });

  it('update + delete', async () => {
    await s.repo.createPaymentComment('u1', { paymentRequestId: 'pr1', text: 'A' });
    const [c] = await s.repo.listPaymentComments('pr1');
    await s.repo.updatePaymentComment(c!.id, 'B');
    expect((await s.repo.listPaymentComments('pr1'))[0]!.text).toBe('B');
    await s.repo.deletePaymentComment(c!.id);
    expect((await s.repo.listPaymentComments('pr1')).length).toBe(0);
  });

  it('unread-counts учитывает чужие комментарии и mark-read', async () => {
    s.fake.seed('payment_request_comments', [
      {
        id: 'c1',
        payment_request_id: 'pr1',
        author_id: 'other',
        text: 'x',
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: null,
        recipient: null,
      },
    ]);
    expect(await s.repo.unreadCountsPayment('u1')).toEqual({ pr1: 1 });
    // свои комментарии не считаются
    expect(await s.repo.unreadCountsPayment('other')).toEqual({});
    // после прочтения — 0
    await s.repo.markReadPayment('u1', 'pr1');
    expect(await s.repo.unreadCountsPayment('u1')).toEqual({});
    // повторный mark-read (update существующей записи)
    await s.repo.markReadPayment('u1', 'pr1');
    expect(await s.repo.unreadCountsPayment('u1')).toEqual({});
  });
});

describe('SupabaseCommentRepository — contract', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    s.fake.seed('users', [
      {
        id: 'u1',
        full_name: 'Иван',
        email: 'i@b.ru',
        role: 'user',
        department_id: 'omts',
        counterparty_id: null,
      },
    ]);
  });

  it('create + list + unread + mark-read', async () => {
    await s.repo.createContractComment('u1', { contractRequestId: 'cr1', text: 'Текст' });
    const list = await s.repo.listContractComments('cr1');
    expect(list.length).toBe(1);
    expect(list[0]!.contractRequestId).toBe('cr1');
    expect(list[0]!.authorFullName).toBe('Иван');

    s.fake.seed('contract_request_comments', [
      {
        id: 'cc1',
        contract_request_id: 'cr1',
        author_id: 'other',
        text: 'y',
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: null,
        recipient: null,
      },
    ]);
    expect(await s.repo.unreadCountsContract('u1')).toEqual({ cr1: 1 });
    await s.repo.markReadContract('u1', 'cr1');
    expect(await s.repo.unreadCountsContract('u1')).toEqual({});
  });
});
