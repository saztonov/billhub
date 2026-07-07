/**
 * Unit-тесты SupabaseApprovalRepository (Phase 7) на FakeSupabase.
 * Покрывают машину состояний согласования (сценарии S1–S14 из equivalence-плана):
 * approve Штаб→ОМТС→[ОМТС-РП]→Согласовано, reject (штатный/админ-форс/блокировки),
 * send-to-revision, complete-revision (restore/смена поставщика/гарды), create-decision (дивергенция).
 * Списки/счётчики с PR_SELECT и .not()/.is() проверяются интеграционно (testcontainers).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseApprovalRepository } from './approval.supabase.js';

function setup() {
  const fake = new FakeSupabase();
  const repo = new SupabaseApprovalRepository(fake as unknown as SupabaseClient);
  return { fake, repo };
}

/** Базовый сид: статусы payment_request по кодам, пользователи, настройки ОМТС-РП. */
function seedBase(fake: FakeSupabase) {
  fake.seed('statuses', [
    { id: 'st-shtab', entity_type: 'payment_request', code: 'approv_shtab', name: 'Штаб' },
    { id: 'st-omts', entity_type: 'payment_request', code: 'approv_omts', name: 'ОМТС' },
    { id: 'st-rp', entity_type: 'payment_request', code: 'approv_omts_rp', name: 'ОМТС РП' },
    { id: 'st-approved', entity_type: 'payment_request', code: 'approved', name: 'Согласована' },
    { id: 'st-revision', entity_type: 'payment_request', code: 'revision', name: 'Доработка' },
    { id: 'st-rejected', entity_type: 'payment_request', code: 'rejected', name: 'Отклонена' },
  ]);
  fake.seed('users', [
    { id: 'u1', email: 'u1@x', full_name: 'User One' },
    { id: 'creator', email: 'c@x', full_name: 'Creator' },
  ]);
  fake.seed('settings', [
    { key: 'omts_rp_sites', value: { site_ids: ['s-rp'] } },
    { key: 'omts_rp_config', value: { responsible_user_id: 'resp' } },
  ]);
}

function rows(fake: FakeSupabase, table: string) {
  return fake.tableRows(table);
}

describe('SupabaseApprovalRepository — approve (forward state machine)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedBase(s.fake);
  });

  it('S1: approve Штаб → ОМТС (создаётся pending ОМТС, current_stage 1→2, status approv_omts)', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 1,
        site_id: 's1',
        status_id: 'st-shtab',
        supplier_id: null,
        created_by: 'creator',
        request_number: '0001',
        stage_history: [],
      },
    ]);
    s.fake.seed('approval_decisions', [
      {
        id: 'd1',
        payment_request_id: 'pr1',
        stage_order: 1,
        department_id: 'shtab',
        status: 'pending',
        is_omts_rp: false,
        comment: '',
      },
    ]);

    const res = await s.repo.decide({
      paymentRequestId: 'pr1',
      department: 'shtab',
      action: 'approve',
      comment: 'ок',
      userId: 'u1',
      isAdmin: false,
    });
    expect(res.ok).toBe(true);

    const decisions = rows(s.fake, 'approval_decisions');
    const d1 = decisions.find((d) => d.id === 'd1')!;
    expect(d1.status).toBe('approved');
    expect(d1.user_id).toBe('u1');
    expect(d1.comment).toBe('ок');
    // Появилось решение ОМТС
    const omts = decisions.find((d) => d.stage_order === 2 && d.department_id === 'omts');
    expect(omts).toBeTruthy();
    expect(omts!.status).toBe('pending');
    expect(omts!.is_omts_rp).toBe(false);

    const pr = rows(s.fake, 'payment_requests')[0]!;
    expect(pr.current_stage).toBe(2);
    expect(pr.status_id).toBe('st-omts');
    expect(pr.omts_entered_at).toBeTruthy();
    expect((pr.stage_history as unknown[]).map((e) => (e as { event: string }).event)).toEqual([
      'approved',
      'received',
    ]);
  });

  it('S2: approve ОМТС финал без РП (site не в omts_rp_sites) → approved, current_stage=null, уведомление создателю', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 2,
        site_id: 's-other',
        status_id: 'st-omts',
        supplier_id: null,
        created_by: 'creator',
        request_number: '0007',
        stage_history: [],
      },
    ]);
    s.fake.seed('approval_decisions', [
      {
        id: 'd2',
        payment_request_id: 'pr1',
        stage_order: 2,
        department_id: 'omts',
        status: 'pending',
        is_omts_rp: false,
        comment: '',
      },
    ]);

    const res = await s.repo.decide({
      paymentRequestId: 'pr1',
      department: 'omts',
      action: 'approve',
      comment: '',
      userId: 'u1',
      isAdmin: false,
    });
    expect(res.ok).toBe(true);

    const pr = rows(s.fake, 'payment_requests')[0]!;
    expect(pr.status_id).toBe('st-approved');
    expect(pr.current_stage).toBeNull();
    expect(pr.approved_at).toBeTruthy();
    expect(pr.omts_approved_at).toBeTruthy();
    // Новое решение НЕ создано
    expect(rows(s.fake, 'approval_decisions').length).toBe(1);
    // Уведомление создателю (creator !== u1)
    const notifs = rows(s.fake, 'notifications');
    expect(notifs.length).toBe(1);
    expect(notifs[0]!.user_id).toBe('creator');
    expect(notifs[0]!.type).toBe('status_changed');
  });

  it('S3: approve ОМТС, site требует РП → создаётся is_omts_rp=true, status approv_omts_rp, current_stage остаётся 2', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 2,
        site_id: 's-rp',
        status_id: 'st-omts',
        supplier_id: null,
        created_by: 'creator',
        request_number: '0008',
        stage_history: [],
      },
    ]);
    s.fake.seed('approval_decisions', [
      {
        id: 'd2',
        payment_request_id: 'pr1',
        stage_order: 2,
        department_id: 'omts',
        status: 'pending',
        is_omts_rp: false,
        comment: '',
      },
    ]);

    const res = await s.repo.decide({
      paymentRequestId: 'pr1',
      department: 'omts',
      action: 'approve',
      comment: '',
      userId: 'u1',
      isAdmin: false,
    });
    expect(res.ok).toBe(true);

    const decisions = rows(s.fake, 'approval_decisions');
    const rp = decisions.find((d) => d.is_omts_rp === true);
    expect(rp).toBeTruthy();
    expect(rp!.status).toBe('pending');

    const pr = rows(s.fake, 'payment_requests')[0]!;
    expect(pr.status_id).toBe('st-rp');
    expect(pr.current_stage).toBe(2);
    expect(pr.omts_approved_at).toBeTruthy();
    expect(pr.approved_at).toBeFalsy();
  });

  it('S4: approve ОМТС-РП финал (текущее решение is_omts_rp=true) → approved', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 2,
        site_id: 's-rp',
        status_id: 'st-rp',
        supplier_id: null,
        created_by: 'creator',
        request_number: '0009',
        stage_history: [],
      },
    ]);
    s.fake.seed('approval_decisions', [
      {
        id: 'd2',
        payment_request_id: 'pr1',
        stage_order: 2,
        department_id: 'omts',
        status: 'approved',
        is_omts_rp: false,
        comment: '',
      },
      {
        id: 'd3',
        payment_request_id: 'pr1',
        stage_order: 2,
        department_id: 'omts',
        status: 'pending',
        is_omts_rp: true,
        comment: '',
      },
    ]);

    const res = await s.repo.decide({
      paymentRequestId: 'pr1',
      department: 'omts',
      action: 'approve',
      comment: '',
      userId: 'u1',
      isAdmin: false,
    });
    expect(res.ok).toBe(true);

    const pr = rows(s.fake, 'payment_requests')[0]!;
    expect(pr.status_id).toBe('st-approved');
    expect(pr.current_stage).toBeNull();
    expect(pr.approved_at).toBeTruthy();
  });

  it('approve: pending-решение не найдено → 404', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 2,
        site_id: 's1',
        status_id: 'st-omts',
        supplier_id: null,
        created_by: 'c',
        request_number: '1',
        stage_history: [],
      },
    ]);
    s.fake.seed('approval_decisions', []);
    const res = await s.repo.decide({
      paymentRequestId: 'pr1',
      department: 'omts',
      action: 'approve',
      comment: '',
      userId: 'u1',
      isAdmin: false,
    });
    expect(res).toEqual({ ok: false, status: 404, error: 'Решение не найдено' });
  });

  it('S10: approve при СБ-отклонённом поставщике → 403, состояние не меняется', async () => {
    s.fake.seed('suppliers', [{ id: 'sup-bad', last_security_status: 'rejected' }]);
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 1,
        site_id: 's1',
        status_id: 'st-shtab',
        supplier_id: 'sup-bad',
        created_by: 'c',
        request_number: '1',
        stage_history: [],
      },
    ]);
    s.fake.seed('approval_decisions', [
      {
        id: 'd1',
        payment_request_id: 'pr1',
        stage_order: 1,
        department_id: 'shtab',
        status: 'pending',
        is_omts_rp: false,
        comment: '',
      },
    ]);
    const res = await s.repo.decide({
      paymentRequestId: 'pr1',
      department: 'shtab',
      action: 'approve',
      comment: '',
      userId: 'u1',
      isAdmin: false,
    });
    expect(res).toEqual({
      ok: false,
      status: 403,
      error: 'Поставщик отклонён службой безопасности — согласование невозможно',
    });
    expect(rows(s.fake, 'approval_decisions')[0]!.status).toBe('pending');
  });

  it('S14: approve заявки на доработке (previous_status_id заполнен) → 409, pending-решение не тронуто', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 2,
        site_id: 's1',
        status_id: 'st-revision',
        previous_status_id: 'st-omts',
        supplier_id: null,
        created_by: 'c',
        request_number: '1',
        stage_history: [],
      },
    ]);
    s.fake.seed('approval_decisions', [
      {
        id: 'd2',
        payment_request_id: 'pr1',
        stage_order: 2,
        department_id: 'omts',
        status: 'pending',
        is_omts_rp: false,
        comment: '',
      },
    ]);
    const res = await s.repo.decide({
      paymentRequestId: 'pr1',
      department: 'omts',
      action: 'approve',
      comment: '',
      userId: 'u1',
      isAdmin: false,
    });
    expect(res).toEqual({
      ok: false,
      status: 409,
      error: 'Заявка находится на доработке — сначала завершите доработку',
    });
    expect(rows(s.fake, 'approval_decisions')[0]!.status).toBe('pending');
    expect(rows(s.fake, 'payment_requests')[0]!.status_id).toBe('st-revision');
  });

  it('decide: отозванная заявка → 400; несуществующая → 404', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 1,
        site_id: 's1',
        status_id: 'st-shtab',
        supplier_id: null,
        withdrawn_at: '2026-01-01T00:00:00Z',
        created_by: 'c',
        request_number: '1',
        stage_history: [],
      },
    ]);
    const withdrawn = await s.repo.decide({
      paymentRequestId: 'pr1',
      department: 'shtab',
      action: 'approve',
      comment: '',
      userId: 'u1',
      isAdmin: false,
    });
    expect(withdrawn).toEqual({
      ok: false,
      status: 400,
      error: 'Невозможно обработать отозванную заявку',
    });
    const missing = await s.repo.decide({
      paymentRequestId: 'nope',
      department: 'shtab',
      action: 'approve',
      comment: '',
      userId: 'u1',
      isAdmin: false,
    });
    expect(missing).toEqual({ ok: false, status: 404, error: 'Заявка не найдена' });
  });
});

describe('SupabaseApprovalRepository — reject', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedBase(s.fake);
  });

  it('S5: reject штатный на ОМТС → decision rejected, PR rejected, rejected_stage=2, previous_status_id=null', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 2,
        site_id: 's1',
        status_id: 'st-omts',
        supplier_id: null,
        created_by: 'c',
        request_number: '0011',
        previous_status_id: 'st-omts',
        stage_history: [],
      },
    ]);
    s.fake.seed('approval_decisions', [
      {
        id: 'd2',
        payment_request_id: 'pr1',
        stage_order: 2,
        department_id: 'omts',
        status: 'pending',
        is_omts_rp: false,
        comment: '',
      },
    ]);

    const res = await s.repo.decide({
      paymentRequestId: 'pr1',
      department: 'omts',
      action: 'reject',
      comment: 'нет',
      userId: 'u1',
      isAdmin: false,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.decisionId).toBe('d2');
      expect(res.requestNumber).toBe('0011');
    }

    const d2 = rows(s.fake, 'approval_decisions')[0]!;
    expect(d2.status).toBe('rejected');
    expect(d2.comment).toBe('нет');

    const pr = rows(s.fake, 'payment_requests')[0]!;
    expect(pr.status_id).toBe('st-rejected');
    expect(pr.rejected_stage).toBe(2);
    expect(pr.current_stage).toBeNull();
    expect(pr.rejected_at).toBeTruthy();
    expect(pr.previous_status_id).toBeNull();
  });

  it('S6: reject не-админ без pending → 404, состояние не меняется', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 2,
        site_id: 's1',
        status_id: 'st-omts',
        supplier_id: null,
        created_by: 'c',
        request_number: '1',
        stage_history: [],
      },
    ]);
    s.fake.seed('approval_decisions', [
      {
        id: 'd2',
        payment_request_id: 'pr1',
        stage_order: 2,
        department_id: 'omts',
        status: 'approved',
        is_omts_rp: false,
        comment: '',
      },
    ]);
    const res = await s.repo.decide({
      paymentRequestId: 'pr1',
      department: 'shtab',
      action: 'reject',
      comment: 'x',
      userId: 'u1',
      isAdmin: false,
    });
    expect(res).toEqual({ ok: false, status: 404, error: 'Решение не найдено' });
    expect(rows(s.fake, 'payment_requests')[0]!.status_id).toBe('st-omts');
  });

  it('S7: reject admin-форс с другими pending → закрываются ВСЕ pending, rejected_stage из первого', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 2,
        site_id: 's1',
        status_id: 'st-omts',
        supplier_id: null,
        created_by: 'c',
        request_number: '1',
        stage_history: [],
      },
    ]);
    s.fake.seed('approval_decisions', [
      {
        id: 'd2',
        payment_request_id: 'pr1',
        stage_order: 2,
        department_id: 'omts',
        status: 'pending',
        is_omts_rp: false,
        comment: '',
      },
      {
        id: 'd3',
        payment_request_id: 'pr1',
        stage_order: 2,
        department_id: 'omts',
        status: 'pending',
        is_omts_rp: true,
        comment: '',
      },
    ]);
    // Департамент без pending (shtab) — попадаем в админ-ветку «закрыть все pending»
    const res = await s.repo.decide({
      paymentRequestId: 'pr1',
      department: 'shtab',
      action: 'reject',
      comment: 'force',
      userId: 'u1',
      isAdmin: true,
    });
    expect(res.ok).toBe(true);
    const decisions = rows(s.fake, 'approval_decisions');
    expect(decisions.every((d) => d.status === 'rejected')).toBe(true);
    const pr = rows(s.fake, 'payment_requests')[0]!;
    expect(pr.status_id).toBe('st-rejected');
    expect(pr.rejected_stage).toBe(2);
  });

  it('S8: reject admin-форс без pending → решения не меняются, rejected_stage из max(stage_order)', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 2,
        site_id: 's1',
        status_id: 'st-omts',
        supplier_id: null,
        created_by: 'c',
        request_number: '1',
        stage_history: [],
      },
    ]);
    s.fake.seed('approval_decisions', [
      {
        id: 'd1',
        payment_request_id: 'pr1',
        stage_order: 1,
        department_id: 'shtab',
        status: 'approved',
        is_omts_rp: false,
        comment: '',
      },
      {
        id: 'd2',
        payment_request_id: 'pr1',
        stage_order: 2,
        department_id: 'omts',
        status: 'approved',
        is_omts_rp: false,
        comment: '',
      },
    ]);
    const res = await s.repo.decide({
      paymentRequestId: 'pr1',
      department: 'omts',
      action: 'reject',
      comment: 'force',
      userId: 'u1',
      isAdmin: true,
    });
    expect(res.ok).toBe(true);
    // Решения не изменены (всё ещё approved)
    expect(rows(s.fake, 'approval_decisions').every((d) => d.status === 'approved')).toBe(true);
    const pr = rows(s.fake, 'payment_requests')[0]!;
    expect(pr.status_id).toBe('st-rejected');
    expect(pr.rejected_stage).toBe(2);
    expect(pr.current_stage).toBeNull();
  });

  it('S9: повторный reject заблокирован по коду статуса (rejected → 400; approved → 400)', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: null,
        site_id: 's1',
        status_id: 'st-rejected',
        supplier_id: null,
        created_by: 'c',
        request_number: '1',
        stage_history: [],
      },
      {
        id: 'pr2',
        current_stage: null,
        site_id: 's1',
        status_id: 'st-approved',
        supplier_id: null,
        created_by: 'c',
        request_number: '2',
        stage_history: [],
      },
    ]);
    const r1 = await s.repo.decide({
      paymentRequestId: 'pr1',
      department: 'omts',
      action: 'reject',
      comment: 'x',
      userId: 'u1',
      isAdmin: true,
    });
    expect(r1).toEqual({ ok: false, status: 400, error: 'Заявка уже отклонена' });
    const r2 = await s.repo.decide({
      paymentRequestId: 'pr2',
      department: 'omts',
      action: 'reject',
      comment: 'x',
      userId: 'u1',
      isAdmin: true,
    });
    expect(r2).toEqual({ ok: false, status: 400, error: 'Нельзя отклонить согласованную заявку' });
  });
});

describe('SupabaseApprovalRepository — revision / complete-revision', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedBase(s.fake);
  });

  it('S11: send-to-revision из approved → status revision, previous=approved, approved_at очищен', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: null,
        site_id: 's1',
        status_id: 'st-approved',
        approved_at: '2026-01-01T00:00:00Z',
        supplier_id: null,
        created_by: 'c',
        request_number: '1',
        stage_history: [],
      },
    ]);
    const res = await s.repo.sendToRevision('pr1', 'u1', 'доработать');
    expect(res).toEqual({ ok: true });
    const pr = rows(s.fake, 'payment_requests')[0]!;
    expect(pr.status_id).toBe('st-revision');
    expect(pr.previous_status_id).toBe('st-approved');
    expect(pr.approved_at).toBeNull();
    const logs = rows(s.fake, 'payment_request_logs');
    expect(logs.some((l) => l.action === 'revision')).toBe(true);
  });

  it('S11b: send-to-revision из rejected → 400', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: null,
        site_id: 's1',
        status_id: 'st-rejected',
        supplier_id: null,
        created_by: 'c',
        request_number: '1',
        stage_history: [],
      },
    ]);
    const res = await s.repo.sendToRevision('pr1', 'u1', 'x');
    expect(res).toEqual({
      ok: false,
      status: 400,
      error: 'Нельзя отправить на доработку отклонённую заявку',
    });
  });

  it('S12: complete-revision восстанавливает approved, архивирует старую сумму, снимает withdrawn', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 2,
        site_id: 's1',
        status_id: 'st-revision',
        previous_status_id: 'st-approved',
        invoice_amount: 100,
        invoice_amount_history: [],
        withdrawn_at: '2026-01-01T00:00:00Z',
        withdrawal_comment: 'был отзыв',
        supplier_id: 'sup1',
        created_by: 'c',
        request_number: '1',
        stage_history: [],
      },
    ]);
    const res = await s.repo.completeRevision('pr1', 'u1', {
      deliveryDays: 5,
      deliveryDaysType: 'working',
      shippingConditionId: 'ship1',
      invoiceAmount: 200,
    });
    expect(res).toEqual({ ok: true });
    const pr = rows(s.fake, 'payment_requests')[0]!;
    expect(pr.status_id).toBe('st-approved');
    expect(pr.previous_status_id).toBeNull();
    expect(pr.approved_at).toBeTruthy();
    expect(pr.withdrawn_at).toBeNull();
    expect(pr.withdrawal_comment).toBeNull();
    expect(pr.invoice_amount).toBe(200);
    expect((pr.invoice_amount_history as { amount: number }[])[0]!.amount).toBe(100);
    const logs = rows(s.fake, 'payment_request_logs');
    expect(logs.some((l) => l.action === 'revision_complete')).toBe(true);
  });

  it('S12b: complete-revision со сменой поставщика → лог supplier_changed перед revision_complete', async () => {
    s.fake.seed('suppliers', [
      { id: 'sup1', name: 'Старый', inn: '111' },
      { id: 'sup2', name: 'Новый', inn: '222' },
    ]);
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 2,
        site_id: 's1',
        status_id: 'st-revision',
        previous_status_id: 'st-omts',
        invoice_amount: 100,
        invoice_amount_history: [],
        supplier_id: 'sup1',
        created_by: 'c',
        request_number: '1',
        stage_history: [],
      },
    ]);
    const res = await s.repo.completeRevision('pr1', 'u1', {
      deliveryDays: 5,
      deliveryDaysType: 'working',
      shippingConditionId: 'ship1',
      invoiceAmount: 100,
      supplierId: 'sup2',
    });
    expect(res).toEqual({ ok: true });
    const pr = rows(s.fake, 'payment_requests')[0]!;
    expect(pr.supplier_id).toBe('sup2');
    const logs = rows(s.fake, 'payment_request_logs');
    const actions = logs.map((l) => l.action);
    expect(actions).toContain('supplier_changed');
    expect(actions.indexOf('supplier_changed')).toBeLessThan(actions.indexOf('revision_complete'));
    const changed = logs.find((l) => l.action === 'supplier_changed')!;
    expect((changed.details as { newSupplierName: string }).newSupplierName).toBe('Новый');
  });

  it('S12c: complete-revision гарды — нет previous → 400; previous=rejected → 400; current=rejected → 400', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'p-noprev',
        current_stage: 2,
        site_id: 's1',
        status_id: 'st-revision',
        previous_status_id: null,
        supplier_id: null,
        created_by: 'c',
        request_number: '1',
        invoice_amount: null,
        invoice_amount_history: [],
        stage_history: [],
      },
      {
        id: 'p-prevrej',
        current_stage: 2,
        site_id: 's1',
        status_id: 'st-revision',
        previous_status_id: 'st-rejected',
        supplier_id: null,
        created_by: 'c',
        request_number: '2',
        invoice_amount: null,
        invoice_amount_history: [],
        stage_history: [],
      },
      {
        id: 'p-currej',
        current_stage: 2,
        site_id: 's1',
        status_id: 'st-rejected',
        previous_status_id: 'st-omts',
        supplier_id: null,
        created_by: 'c',
        request_number: '3',
        invoice_amount: null,
        invoice_amount_history: [],
        stage_history: [],
      },
    ]);
    const fu = {
      deliveryDays: 1,
      deliveryDaysType: 'working',
      shippingConditionId: 'ship1',
      invoiceAmount: 10,
    };
    expect(await s.repo.completeRevision('p-noprev', 'u1', fu)).toEqual({
      ok: false,
      status: 400,
      error: 'Нет предыдущего статуса',
    });
    expect(await s.repo.completeRevision('p-prevrej', 'u1', fu)).toEqual({
      ok: false,
      status: 400,
      error: 'Нельзя вернуть заявку в статус отклонения',
    });
    expect(await s.repo.completeRevision('p-currej', 'u1', fu)).toEqual({
      ok: false,
      status: 400,
      error: 'Нельзя завершить доработку на отклонённой заявке',
    });
  });
});

describe('SupabaseApprovalRepository — create-decision (намеренная дивергенция от decide)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedBase(s.fake);
  });

  it('S13: create-decision меняет ТОЛЬКО решение, НЕ продвигает машину состояний', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 2,
        site_id: 's1',
        status_id: 'st-omts',
        supplier_id: null,
        created_by: 'c',
        request_number: '1',
        stage_history: [],
      },
    ]);
    s.fake.seed('approval_decisions', [
      {
        id: 'd2',
        payment_request_id: 'pr1',
        stage_order: 2,
        department_id: 'omts',
        status: 'pending',
        is_omts_rp: false,
        comment: '',
      },
    ]);
    const res = await s.repo.createDecisionOnly({
      paymentRequestId: 'pr1',
      department: 'omts',
      action: 'approve',
      comment: 'ok',
      userId: 'u1',
      isAdmin: false,
    });
    expect(res).toEqual({ ok: true, decisionId: 'd2' });

    expect(rows(s.fake, 'approval_decisions')[0]!.status).toBe('approved');
    // PR не тронут
    const pr = rows(s.fake, 'payment_requests')[0]!;
    expect(pr.status_id).toBe('st-omts');
    expect(pr.current_stage).toBe(2);
    expect(pr.approved_at).toBeUndefined();
    // Новых решений нет, stage_history пуст, уведомлений нет
    expect(rows(s.fake, 'approval_decisions').length).toBe(1);
    expect((pr.stage_history as unknown[]).length).toBe(0);
    expect(rows(s.fake, 'notifications').length).toBe(0);
  });

  it('create-decision: pending не найдено → 404; отозванная → 400', async () => {
    s.fake.seed('payment_requests', [
      {
        id: 'pr1',
        current_stage: 2,
        site_id: 's1',
        status_id: 'st-omts',
        supplier_id: null,
        created_by: 'c',
        request_number: '1',
        stage_history: [],
      },
      {
        id: 'pr2',
        current_stage: 2,
        site_id: 's1',
        status_id: 'st-omts',
        withdrawn_at: '2026-01-01T00:00:00Z',
        supplier_id: null,
        created_by: 'c',
        request_number: '2',
        stage_history: [],
      },
    ]);
    s.fake.seed('approval_decisions', []);
    expect(
      await s.repo.createDecisionOnly({
        paymentRequestId: 'pr1',
        department: 'omts',
        action: 'approve',
        comment: '',
        userId: 'u1',
        isAdmin: false,
      }),
    ).toEqual({ ok: false, status: 404, error: 'Решение не найдено' });
    expect(
      await s.repo.createDecisionOnly({
        paymentRequestId: 'pr2',
        department: 'omts',
        action: 'approve',
        comment: '',
        userId: 'u1',
        isAdmin: false,
      }),
    ).toEqual({ ok: false, status: 400, error: 'Невозможно обработать отозванную заявку' });
  });
});
