/**
 * Unit-тесты SupabasePaymentRequestRepository (Phase 4) на FakeSupabase.
 * Покрывают write-методы: create (status approv_shtab, stage 1, approval_decisions, stage_history),
 * resubmit (КРИТИЧНО: очистка withdrawn_at), withdraw, update (дифф + лог + 403/404),
 * addFile (счётчики), setFileRejection, soft-delete; и простые чтения.
 * Сложные join-методы (list/getById/listFiles) проверяются интеграционно (testcontainers).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabasePaymentRequestRepository } from './payment-request.supabase.js';
import { NotFoundError, ForbiddenError } from '../types.js';

function setup() {
  const fake = new FakeSupabase();
  const repo = new SupabasePaymentRequestRepository(fake as unknown as SupabaseClient);
  return { fake, repo };
}

function seedStatuses(fake: FakeSupabase) {
  fake.seed('statuses', [
    {
      id: 'st-shtab',
      entity_type: 'payment_request',
      code: 'approv_shtab',
      name: 'Согласование Штаб',
    },
    { id: 'st-withdrawn', entity_type: 'payment_request', code: 'withdrawn', name: 'Отозвана' },
  ]);
}

describe('SupabasePaymentRequestRepository — create', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedStatuses(s.fake);
    s.fake.setRpcResult('generate_request_number', 'PR-2026-001');
  });

  it('создаёт заявку: status approv_shtab, current_stage=1, stage_history, approval_decisions', async () => {
    const res = await s.repo.create({
      counterpartyId: 'cp1',
      siteId: 'site1',
      deliveryDays: 10,
      deliveryDaysType: 'working',
      shippingConditionId: 'ship1',
      comment: 'тест',
      totalFiles: 2,
      invoiceAmount: 1000,
      supplierId: 'sup1',
      createdBy: 'u1',
    });
    expect(res.requestNumber).toBe('PR-2026-001');

    const pr = s.fake.tableRows('payment_requests')[0]!;
    expect(pr.status_id).toBe('st-shtab');
    expect(pr.current_stage).toBe(1);
    expect(pr.uploaded_files).toBe(0);
    expect((pr.stage_history as unknown[]).length).toBe(1);

    const decisions = s.fake.tableRows('approval_decisions');
    expect(decisions.length).toBe(1);
    expect(decisions[0]!.stage_order).toBe(1);
    expect(decisions[0]!.department_id).toBe('shtab');
    expect(decisions[0]!.status).toBe('pending');
  });
});

describe('SupabasePaymentRequestRepository — resubmit (миграция 004)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedStatuses(s.fake);
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        status_id: 'st-withdrawn',
        withdrawn_at: '2026-05-01T00:00:00.000Z',
        withdrawal_comment: 'отозвана',
        resubmit_count: 1,
        rejected_stage: 2,
        rejected_at: '2026-05-01T00:00:00.000Z',
        approved_at: null,
        current_stage: null,
        site_id: 'site1',
        invoice_amount: 500,
        invoice_amount_history: [],
        stage_history: [],
      },
    ]);
    s.fake.seed('approval_decisions', [
      {
        id: 'd-old',
        payment_request_id: 'pr1',
        stage_order: 1,
        department_id: 'shtab',
        status: 'pending',
      },
    ]);
  });

  it('КРИТИЧНО: очищает withdrawn_at и withdrawal_comment, возвращает на Штаб', async () => {
    await s.repo.resubmit('pr1', { comment: 'снова на согласование' }, 'u1');

    const pr = s.fake.tableRows('payment_requests')[0]!;
    expect(pr.withdrawn_at).toBeNull(); // ← главный инвариант
    expect(pr.withdrawal_comment).toBeNull();
    expect(pr.status_id).toBe('st-shtab');
    expect(pr.current_stage).toBe(1);
    expect(pr.rejected_at).toBeNull();
    expect(pr.rejected_stage).toBeNull();
    expect(pr.resubmit_count).toBe(2);

    // pending-решение Штаба пересоздано (старое удалено, новое вставлено)
    const pending = s.fake
      .tableRows('approval_decisions')
      .filter((d) => d.status === 'pending' && d.department_id === 'shtab');
    expect(pending.length).toBe(1);

    // лог resubmit
    const logs = s.fake.tableRows('payment_request_logs');
    expect(logs.some((l) => l.action === 'resubmit')).toBe(true);
  });

  it('fieldUpdates архивирует прежнюю сумму в invoice_amount_history', async () => {
    await s.repo.resubmit(
      'pr1',
      {
        comment: 'с новой суммой',
        fieldUpdates: {
          deliveryDays: 20,
          deliveryDaysType: 'calendar',
          shippingConditionId: 'ship2',
          invoiceAmount: 900,
        },
      },
      'u1',
    );
    const pr = s.fake.tableRows('payment_requests')[0]!;
    expect((pr.invoice_amount_history as unknown[]).length).toBe(1);
    expect(pr.invoice_amount).toBe(900);
    expect(pr.delivery_days).toBe(20);
  });
});

describe('SupabasePaymentRequestRepository — withdraw / update / soft-delete', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedStatuses(s.fake);
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        counterparty_id: 'cp1',
        delivery_days: 10,
        delivery_days_type: 'working',
        shipping_condition_id: 'ship1',
        site_id: 'site1',
        comment: 'old',
        invoice_amount: 100,
        invoice_amount_history: [],
        total_files: 3,
        supplier_id: null,
        is_deleted: false,
      },
    ]);
  });

  it('withdraw ставит статус withdrawn + withdrawn_at + comment', async () => {
    await s.repo.withdraw('pr1', 'причина');
    const pr = s.fake.tableRows('payment_requests')[0]!;
    expect(pr.status_id).toBe('st-withdrawn');
    expect(pr.withdrawn_at).toBeTruthy();
    expect(pr.withdrawal_comment).toBe('причина');
  });

  it('update меняет поля и пишет лог edit', async () => {
    await s.repo.update('pr1', { deliveryDays: 20, comment: 'new' }, { userId: 'u1' });
    const pr = s.fake.tableRows('payment_requests')[0]!;
    expect(pr.delivery_days).toBe(20);
    expect(pr.comment).toBe('new');
    const logs = s.fake.tableRows('payment_request_logs');
    expect(logs.length).toBe(1);
    expect(logs[0]!.action).toBe('edit');
  });

  it('update чужого контрагента → ForbiddenError; несуществующего → NotFoundError', async () => {
    await expect(
      s.repo.update('pr1', { deliveryDays: 30 }, { userId: 'u1', actingCounterpartyId: 'other' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      s.repo.update('missing', { deliveryDays: 30 }, { userId: 'u1' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('soft-delete ставит is_deleted', async () => {
    await s.repo.softDelete('pr1');
    expect(s.fake.tableRows('payment_requests')[0]!.is_deleted).toBe(true);
  });
});

describe('SupabasePaymentRequestRepository — files & простые чтения', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        counterparty_id: 'cp1',
        request_number: 'PR-1',
        uploaded_files: 2,
        total_files: 5,
      },
    ]);
  });

  it('addFile: +1 uploaded; +1 total для additional/resubmit', async () => {
    await s.repo.addFile('pr1', {
      documentTypeId: 'dt1',
      fileName: 'a.pdf',
      fileKey: 'k1',
      fileSize: 10,
      mimeType: 'application/pdf',
      pageCount: 1,
      userId: 'u1',
      isAdditional: true,
      isResubmit: false,
    });
    const pr = s.fake.tableRows('payment_requests')[0]!;
    expect(pr.uploaded_files).toBe(3);
    expect(pr.total_files).toBe(6);
    expect(s.fake.tableRows('payment_request_files').length).toBe(1);
  });

  it('addFile без additional/resubmit не трогает total_files', async () => {
    await s.repo.addFile('pr1', {
      documentTypeId: 'dt1',
      fileName: 'b.pdf',
      fileKey: 'k2',
      fileSize: 10,
      mimeType: null,
      pageCount: null,
      userId: 'u1',
    });
    const pr = s.fake.tableRows('payment_requests')[0]!;
    expect(pr.uploaded_files).toBe(3);
    expect(pr.total_files).toBe(5);
  });

  it('getFileRejection + setFileRejection', async () => {
    s.fake.seed('payment_request_files', [{ id: 'f1', is_rejected: false }]);
    expect(await s.repo.getFileRejection('f1')).toBe(false);
    expect(await s.repo.getFileRejection('missing')).toBeNull();
    await s.repo.setFileRejection('f1', true, 'u1');
    const f = s.fake.tableRows('payment_request_files')[0]!;
    expect(f.is_rejected).toBe(true);
    expect(f.rejected_by).toBe('u1');
  });

  it('getRequestNumber / getOwnerCounterpartyId / getUserSiteIds', async () => {
    expect(await s.repo.getRequestNumber('pr1')).toBe('PR-1');
    expect(await s.repo.getRequestNumber('missing')).toBeNull();
    expect(await s.repo.getOwnerCounterpartyId('pr1')).toBe('cp1');
    expect(await s.repo.getOwnerCounterpartyId('missing')).toBeNull();
    s.fake.seed('user_construction_sites_mapping', [
      { id: 'm1', user_id: 'u1', construction_site_id: 'site1' },
      { id: 'm2', user_id: 'u1', construction_site_id: 'site2' },
    ]);
    expect((await s.repo.getUserSiteIds('u1')).sort()).toEqual(['site1', 'site2']);
  });

  it('setStatus / setDpData', async () => {
    await s.repo.setStatus('pr1', 'st-x');
    expect(s.fake.tableRows('payment_requests')[0]!.status_id).toBe('st-x');
    await s.repo.setDpData('pr1', {
      dpNumber: 'DP-1',
      dpDate: '2026-05-01',
      dpAmount: 1234.5,
      dpFileKey: 'dpk',
      dpFileName: 'dp.pdf',
    });
    const pr = s.fake.tableRows('payment_requests')[0]!;
    expect(pr.dp_number).toBe('DP-1');
    expect(pr.dp_amount).toBe(1234.5);
  });
});
