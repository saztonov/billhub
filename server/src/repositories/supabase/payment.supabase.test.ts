/**
 * Unit-тесты SupabasePaymentRepository (Phase 6) на FakeSupabase.
 * Покрывают recalc total_paid + paid_status (not_paid/partially_paid/paid), create (next number),
 * addFile (is_executed=true → счёт суммы), deleteFile (re-derive is_executed), update, delete, recalcStatus.
 * list (вложенный join) проверяется интеграционно (testcontainers).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabasePaymentRepository } from './payment.supabase.js';
import { NotFoundError } from '../types.js';

function setup() {
  const fake = new FakeSupabase();
  const repo = new SupabasePaymentRepository(fake as unknown as SupabaseClient);
  return { fake, repo };
}

function seedPaidStatuses(fake: FakeSupabase) {
  fake.seed('statuses', [
    { id: 'p-none', entity_type: 'paid', code: 'not_paid' },
    { id: 'p-part', entity_type: 'paid', code: 'partially_paid' },
    { id: 'p-full', entity_type: 'paid', code: 'paid' },
  ]);
}

describe('SupabasePaymentRepository — create + recalc', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedPaidStatuses(s.fake);
    s.fake.seed('payment_requests', [{ id: 'pr1', invoice_amount: 1000 }]);
  });

  it('create: payment_number=1, новая оплата не исполнена → total_paid 0, статус not_paid', async () => {
    const res = await s.repo.create({
      paymentRequestId: 'pr1',
      paymentDate: '2026-05-01',
      amount: 500,
      createdBy: 'u1',
    });
    expect(res.id).toBeTruthy();
    const pay = s.fake.tableRows('payment_payments')[0]!;
    expect(pay.payment_number).toBe(1);
    expect(pay.amount).toBe(500);
    const pr = s.fake.tableRows('payment_requests')[0]!;
    expect(pr.total_paid).toBe(0);
    expect(pr.paid_status_id).toBe('p-none'); // не исполнена → не считается
  });

  it('create второй оплаты → payment_number=2', async () => {
    s.fake.seed('payment_payments', [
      { id: 'p1', payment_request_id: 'pr1', payment_number: 1, amount: 100 },
    ]);
    await s.repo.create({
      paymentRequestId: 'pr1',
      paymentDate: '2026-05-02',
      amount: 200,
      createdBy: 'u1',
    });
    const nums = s.fake.tableRows('payment_payments').map((p) => p.payment_number);
    expect(nums).toContain(2);
  });
});

describe('SupabasePaymentRepository — paid status derivation', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedPaidStatuses(s.fake);
    s.fake.seed('payment_requests', [{ id: 'pr1', invoice_amount: 1000 }]);
    s.fake.seed('payment_payments', [
      { id: 'p1', payment_request_id: 'pr1', amount: 500, is_executed: false },
    ]);
  });

  it('addFile делает оплату исполненной → partially_paid (500 < 1000)', async () => {
    await s.repo.addFile(
      'p1',
      { fileName: 'a.pdf', fileKey: 'k1', fileSize: 10, mimeType: null },
      'u1',
    );
    expect(s.fake.tableRows('payment_payments')[0]!.is_executed).toBe(true);
    const pr = s.fake.tableRows('payment_requests')[0]!;
    expect(pr.total_paid).toBe(500);
    expect(pr.paid_status_id).toBe('p-part');
  });

  it('полная оплата → paid (1000 >= 1000)', async () => {
    s.fake.tableRows('payment_payments')[0]!.amount = 1000;
    s.fake.tableRows('payment_payments')[0]!.is_executed = true;
    const res = await s.repo.recalcStatus('pr1');
    expect(res.totalPaid).toBe(1000);
    expect(res.paidStatusId).toBe('p-full');
    expect(s.fake.tableRows('payment_requests')[0]!.paid_status_id).toBe('p-full');
  });

  it('deleteFile: если файлов не осталось → is_executed=false → not_paid', async () => {
    s.fake.tableRows('payment_payments')[0]!.is_executed = true;
    s.fake.seed('payment_payment_files', [{ id: 'f1', payment_payment_id: 'p1' }]);
    await s.repo.deleteFile('f1', 'p1');
    expect(s.fake.tableRows('payment_payments')[0]!.is_executed).toBe(false);
    expect(s.fake.tableRows('payment_requests')[0]!.paid_status_id).toBe('p-none');
  });

  it('deleteFile без paymentId не пересчитывает', async () => {
    s.fake.seed('payment_payment_files', [{ id: 'f1', payment_payment_id: 'p1' }]);
    s.fake.tableRows('payment_payments')[0]!.is_executed = true;
    await s.repo.deleteFile('f1');
    // is_executed не тронут (нет paymentId)
    expect(s.fake.tableRows('payment_payments')[0]!.is_executed).toBe(true);
    expect(s.fake.tableRows('payment_payment_files').length).toBe(0);
  });
});

describe('SupabasePaymentRepository — update / delete', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedPaidStatuses(s.fake);
    s.fake.seed('payment_requests', [{ id: 'pr1', invoice_amount: 1000 }]);
    s.fake.seed('payment_payments', [
      { id: 'p1', payment_request_id: 'pr1', amount: 200, is_executed: true },
    ]);
  });

  it('update меняет amount + updated_by/updated_at и пересчитывает', async () => {
    await s.repo.update('p1', { amount: 1000 }, 'u9');
    const pay = s.fake.tableRows('payment_payments')[0]!;
    expect(pay.amount).toBe(1000);
    expect(pay.updated_by).toBe('u9');
    expect(pay.updated_at).toBeTruthy();
    expect(s.fake.tableRows('payment_requests')[0]!.paid_status_id).toBe('p-full');
  });

  it('delete удаляет + пересчитывает; несуществующего → NotFoundError', async () => {
    await s.repo.delete('p1');
    expect(s.fake.tableRows('payment_payments').length).toBe(0);
    expect(s.fake.tableRows('payment_requests')[0]!.paid_status_id).toBe('p-none');
    await expect(s.repo.delete('missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});
