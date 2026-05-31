/**
 * Unit-тесты SupabaseNotificationActionRepository (Phase 2d) на FakeSupabase.
 * Покрывают выбор получателей (департамент/контрагент/конкретный user/по умолчанию),
 * исключение актора, union all_sites + привязки, ветки resubmitted/check-specialists.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseNotificationActionRepository } from './notification-action.supabase.js';

function setup() {
  const fake = new FakeSupabase();
  const repo = new SupabaseNotificationActionRepository(fake as unknown as SupabaseClient);
  return { fake, repo };
}

function seedWorld(fake: FakeSupabase) {
  fake.seed('users', [
    { id: 'shtabAll', department_id: 'shtab', all_sites: true, is_active: true, role: 'user' },
    { id: 'shtabSite', department_id: 'shtab', all_sites: false, is_active: true, role: 'user' },
    { id: 'omtsSite', department_id: 'omts', all_sites: false, is_active: true, role: 'user' },
    {
      id: 'shtabInactive',
      department_id: 'shtab',
      all_sites: true,
      is_active: false,
      role: 'user',
    },
    { id: 'admin1', role: 'admin', is_active: true, department_id: null, all_sites: false },
    {
      id: 'creator',
      role: 'counterparty_user',
      is_active: true,
      department_id: null,
      all_sites: false,
    },
  ]);
  fake.seed('user_construction_sites_mapping', [
    { id: 'm1', user_id: 'shtabSite', construction_site_id: 'site1' },
    { id: 'm2', user_id: 'omtsSite', construction_site_id: 'site1' },
  ]);
  fake.seed('payment_requests', [
    {
      id: 'pr1',
      site_id: 'site1',
      created_by: 'creator',
      request_number: 'PR-1',
      current_stage: 1,
    },
  ]);
  fake.seed('contract_requests', [
    { id: 'cr1', site_id: 'site1', created_by: 'creator', request_number: 'CR-1' },
  ]);
}

function notifUserIds(fake: FakeSupabase): string[] {
  return fake
    .tableRows('notifications')
    .map((n) => n.user_id as string)
    .sort();
}

describe('SupabaseNotificationActionRepository', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedWorld(s.fake);
  });

  it('paymentNewPending: штаб (all_sites + привязка к объекту), исключая актора', async () => {
    await s.repo.paymentNewPending({
      paymentRequestId: 'pr1',
      siteId: 'site1',
      actorUserId: 'shtabSite',
      requestNumber: 'PR-1',
    });
    // shtabAll (all_sites) + shtabSite(привязка) минус актор shtabSite → только shtabAll
    expect(notifUserIds(s.fake)).toEqual(['shtabAll']);
  });

  it('paymentStatusChanged: уведомляет создателя; актор=создатель → no-op', async () => {
    await s.repo.paymentStatusChanged({
      paymentRequestId: 'pr1',
      statusLabel: 'Согласовано',
      actorUserId: 'shtabAll',
    });
    expect(notifUserIds(s.fake)).toEqual(['creator']);
    // повтор как создатель — без новых уведомлений
    s.fake.seed('notifications', []);
    await s.repo.paymentStatusChanged({
      paymentRequestId: 'pr1',
      statusLabel: 'X',
      actorUserId: 'creator',
    });
    expect(s.fake.tableRows('notifications').length).toBe(0);
  });

  it('checkSpecialists: есть специалисты → no-op; нет → уведомление админам', async () => {
    await s.repo.checkSpecialists({ paymentRequestId: 'pr1', siteId: 'site1', department: 'omts' });
    expect(s.fake.tableRows('notifications').length).toBe(0); // omtsSite существует

    await s.repo.checkSpecialists({
      paymentRequestId: 'pr1',
      siteId: 'site1',
      department: 'smetny',
    });
    expect(notifUserIds(s.fake)).toEqual(['admin1']); // нет сметных → админам
    expect(s.fake.tableRows('notifications')[0]!.type).toBe('missing_specialist');
  });

  it('paymentResubmitted: штаб всегда; +ОМТС при rejectedStage=2', async () => {
    await s.repo.paymentResubmitted({
      paymentRequestId: 'pr1',
      actorUserId: 'nobody',
      rejectedStage: 1,
    });
    expect(notifUserIds(s.fake)).toEqual(['shtabAll', 'shtabSite']);

    s.fake.seed('notifications', []);
    await s.repo.paymentResubmitted({
      paymentRequestId: 'pr1',
      actorUserId: 'nobody',
      rejectedStage: 2,
    });
    expect(notifUserIds(s.fake)).toEqual(['omtsSite', 'shtabAll', 'shtabSite']);
  });

  it('omtsRpPending: ОМТС объекта, исключая актора', async () => {
    await s.repo.omtsRpPending({ paymentRequestId: 'pr1', actorUserId: 'nobody' });
    expect(notifUserIds(s.fake)).toEqual(['omtsSite']);
  });

  it('paymentAssigned: назначенному; актор=назначенный → no-op', async () => {
    await s.repo.paymentAssigned({
      paymentRequestId: 'pr1',
      assignedUserId: 'omtsSite',
      actorUserId: 'shtabAll',
    });
    expect(notifUserIds(s.fake)).toEqual(['omtsSite']);
    s.fake.seed('notifications', []);
    await s.repo.paymentAssigned({
      paymentRequestId: 'pr1',
      assignedUserId: 'x',
      actorUserId: 'x',
    });
    expect(s.fake.tableRows('notifications').length).toBe(0);
  });

  describe('paymentNewComment — выбор получателей', () => {
    it('без recipient → создатель + штаб', async () => {
      await s.repo.paymentNewComment({
        paymentRequestId: 'pr1',
        actorUserId: 'nobody',
        recipient: null,
      });
      expect(notifUserIds(s.fake)).toEqual(['creator', 'shtabAll', 'shtabSite']);
    });

    it('recipient=omts → пользователи ОМТС', async () => {
      await s.repo.paymentNewComment({
        paymentRequestId: 'pr1',
        actorUserId: 'nobody',
        recipient: 'omts',
      });
      expect(notifUserIds(s.fake)).toEqual(['omtsSite']);
    });

    it('recipient=counterparty → создатель', async () => {
      await s.repo.paymentNewComment({
        paymentRequestId: 'pr1',
        actorUserId: 'nobody',
        recipient: 'counterparty',
      });
      expect(notifUserIds(s.fake)).toEqual(['creator']);
    });

    it('recipient=конкретный userId → только он', async () => {
      await s.repo.paymentNewComment({
        paymentRequestId: 'pr1',
        actorUserId: 'nobody',
        recipient: 'someUser',
      });
      expect(notifUserIds(s.fake)).toEqual(['someUser']);
    });
  });

  it('contractRevision: counterparty + shtab', async () => {
    await s.repo.contractRevision({
      contractRequestId: 'cr1',
      targets: ['counterparty', 'shtab'],
      actorUserId: 'nobody',
    });
    expect(notifUserIds(s.fake)).toEqual(['creator', 'shtabAll', 'shtabSite']);
  });

  it('contractNewRequest: ОМТС объекта', async () => {
    await s.repo.contractNewRequest({
      contractRequestId: 'cr1',
      siteId: 'site1',
      actorUserId: 'nobody',
      requestNumber: 'CR-1',
    });
    expect(notifUserIds(s.fake)).toEqual(['omtsSite']);
    expect(s.fake.tableRows('notifications')[0]!.type).toBe('contract_new_request');
  });

  it('contractStatusChanged: создателю; актор=создатель → no-op', async () => {
    await s.repo.contractStatusChanged({
      contractRequestId: 'cr1',
      statusLabel: 'Готово',
      actorUserId: 'nobody',
    });
    expect(notifUserIds(s.fake)).toEqual(['creator']);
  });
});
