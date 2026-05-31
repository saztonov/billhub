/**
 * Unit-тесты SupabaseContractRequestRepository (Phase 5) на FakeSupabase.
 * Покрывают state-machine: create, update (strip counterparty), переходы статусов
 * (revision/complete/approve/original-received/revert/reject с гардами), assign,
 * status-counts, getStatusGate, addFile (гейт подписанного договора), файлы.
 * Join-методы list/getById проверяются интеграционно (testcontainers).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseContractRequestRepository } from './contract-request.supabase.js';
import { NotFoundError, ValidationError } from '../types.js';

function setup() {
  const fake = new FakeSupabase();
  const repo = new SupabaseContractRequestRepository(fake as unknown as SupabaseClient);
  return { fake, repo };
}

function seedStatuses(fake: FakeSupabase) {
  fake.seed('statuses', [
    {
      id: 's-omts',
      entity_type: 'contract_request',
      code: 'approv_omts',
      name: 'Согласование ОМТС',
    },
    { id: 's-rev', entity_type: 'contract_request', code: 'on_revision', name: 'На доработке' },
    {
      id: 's-wait',
      entity_type: 'contract_request',
      code: 'approved_waiting',
      name: 'Ожидание оригинала',
    },
    { id: 's-concl', entity_type: 'contract_request', code: 'concluded', name: 'Заключен' },
    { id: 's-rej', entity_type: 'contract_request', code: 'rejected', name: 'Отклонено' },
  ]);
}

describe('SupabaseContractRequestRepository — create', () => {
  it('создаёт заявку: status approv_omts + status_history created', async () => {
    const s = setup();
    seedStatuses(s.fake);
    s.fake.seed('users', [{ id: 'u1', full_name: 'Иван', email: 'i@b.ru' }]);
    s.fake.setRpcResult('generate_contract_request_number', 'Д-26-1');

    const res = await s.repo.create({
      siteId: 'site1',
      counterpartyId: 'cp1',
      supplierId: 'sup1',
      partiesCount: 2,
      subjectType: 'goods',
      subjectDetail: 'детали',
      createdBy: 'u1',
    });
    expect(res.requestNumber).toBe('Д-26-1');
    const cr = s.fake.tableRows('contract_requests')[0]!;
    expect(cr.status_id).toBe('s-omts');
    const history = cr.status_history as Record<string, unknown>[];
    expect(history.length).toBe(1);
    expect(history[0]!.event).toBe('created');
    expect(history[0]!.userFullName).toBe('Иван');
  });
});

describe('SupabaseContractRequestRepository — state machine', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedStatuses(s.fake);
    s.fake.seed('users', [{ id: 'u1', full_name: 'Иван', email: 'i@b.ru' }]);
    s.fake.seed('contract_requests', [
      {
        id: 'cr1',
        counterparty_id: 'cp1',
        supplier_id: 'sup1',
        status_id: 's-omts',
        revision_targets: [],
        status_history: [],
      },
    ]);
  });

  it('sendToRevision: статус on_revision + targets + история', async () => {
    await s.repo.sendToRevision('cr1', ['shtab', 'omts'], 'u1');
    const cr = s.fake.tableRows('contract_requests')[0]!;
    expect(cr.status_id).toBe('s-rev');
    expect(cr.revision_targets).toEqual(['shtab', 'omts']);
    expect((cr.status_history as unknown[]).length).toBe(1);
  });

  it('completeRevision: частичный остаток не меняет статус; последний → approv_omts', async () => {
    s.fake.tableRows('contract_requests')[0]!.revision_targets = ['shtab', 'omts'];
    s.fake.tableRows('contract_requests')[0]!.status_id = 's-rev';
    await s.repo.completeRevision('cr1', 'shtab', 'u1');
    expect(s.fake.tableRows('contract_requests')[0]!.revision_targets).toEqual(['omts']);
    expect(s.fake.tableRows('contract_requests')[0]!.status_id).toBe('s-rev');
    await s.repo.completeRevision('cr1', 'omts', 'u1');
    expect(s.fake.tableRows('contract_requests')[0]!.revision_targets).toEqual([]);
    expect(s.fake.tableRows('contract_requests')[0]!.status_id).toBe('s-omts');
  });

  it('completeRevision несуществующей → NotFoundError', async () => {
    await expect(s.repo.completeRevision('missing', 'shtab', 'u1')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('approve: approved_waiting + revision_targets=[]', async () => {
    s.fake.tableRows('contract_requests')[0]!.revision_targets = ['shtab'];
    await s.repo.approve('cr1', 'u1');
    const cr = s.fake.tableRows('contract_requests')[0]!;
    expect(cr.status_id).toBe('s-wait');
    expect(cr.revision_targets).toEqual([]);
  });

  it('markOriginalReceived: concluded + original_received_at', async () => {
    await s.repo.markOriginalReceived('cr1', 'u1');
    const cr = s.fake.tableRows('contract_requests')[0]!;
    expect(cr.status_id).toBe('s-concl');
    expect(cr.original_received_at).toBeTruthy();
  });

  it('revertToPrevious: approved_waiting → approv_omts (revision_targets=[]); concluded → approved_waiting (original_received_at=null)', async () => {
    s.fake.tableRows('contract_requests')[0]!.status_id = 's-wait';
    s.fake.tableRows('contract_requests')[0]!.revision_targets = ['x'];
    await s.repo.revertToPrevious('cr1', 'u1', 'назад');
    let cr = s.fake.tableRows('contract_requests')[0]!;
    expect(cr.status_id).toBe('s-omts');
    expect(cr.revision_targets).toEqual([]);

    s.fake.tableRows('contract_requests')[0]!.status_id = 's-concl';
    s.fake.tableRows('contract_requests')[0]!.original_received_at = '2026-05-01T00:00:00.000Z';
    await s.repo.revertToPrevious('cr1', 'u1');
    cr = s.fake.tableRows('contract_requests')[0]!;
    expect(cr.status_id).toBe('s-wait');
    expect(cr.original_received_at).toBeNull();
  });

  it('revertToPrevious из approv_omts (нет предыдущего) → ValidationError', async () => {
    await expect(s.repo.revertToPrevious('cr1', 'u1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('reject: статус rejected + история с comment; из concluded → ValidationError', async () => {
    await s.repo.reject('cr1', 'u1', 'причина');
    const cr = s.fake.tableRows('contract_requests')[0]!;
    expect(cr.status_id).toBe('s-rej');
    const history = cr.status_history as Record<string, unknown>[];
    expect(history[history.length - 1]!.event).toBe('rejected');
    expect(history[history.length - 1]!.comment).toBe('причина');

    s.fake.tableRows('contract_requests')[0]!.status_id = 's-concl';
    await expect(s.repo.reject('cr1', 'u1', 'нельзя')).rejects.toBeInstanceOf(ValidationError);
  });

  it('assign: responsible_user_id + история', async () => {
    await s.repo.assign('cr1', 'u1');
    expect(s.fake.tableRows('contract_requests')[0]!.responsible_user_id).toBe('u1');
  });

  it('getStatusGate возвращает counterpartyId + statusCode', async () => {
    expect(await s.repo.getStatusGate('cr1')).toEqual({
      counterpartyId: 'cp1',
      statusCode: 'approv_omts',
    });
    expect(await s.repo.getStatusGate('missing')).toBeNull();
  });

  it('update: strip counterparty для подрядчика', async () => {
    await s.repo.update(
      'cr1',
      { subjectType: 'works', counterpartyId: 'cpX' },
      { stripCounterparty: true },
    );
    const cr = s.fake.tableRows('contract_requests')[0]!;
    expect(cr.subject_type).toBe('works');
    expect(cr.counterparty_id).toBe('cp1'); // не изменён
  });
});

describe('SupabaseContractRequestRepository — files & counts', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedStatuses(s.fake);
  });

  it('addFile: is_signed_contract только в approved_waiting/concluded', async () => {
    s.fake.seed('contract_requests', [{ id: 'cr1', status_id: 's-wait' }]);
    await s.repo.addFile('cr1', {
      fileName: 'c.pdf',
      fileKey: 'k1',
      fileSize: 10,
      mimeType: 'application/pdf',
      userId: 'u1',
      isSignedContract: true,
    });
    expect(s.fake.tableRows('contract_request_files')[0]!.is_signed_contract).toBe(true);

    s.fake.seed('contract_requests', [{ id: 'cr2', status_id: 's-omts' }]);
    await s.repo.addFile('cr2', {
      fileName: 'd.pdf',
      fileKey: 'k2',
      fileSize: 10,
      mimeType: null,
      userId: 'u1',
      isSignedContract: true,
    });
    const f2 = s.fake.tableRows('contract_request_files').find((f) => f.file_key === 'k2')!;
    expect(f2.is_signed_contract).toBe(false);
  });

  it('file rejection + signed-contract setters', async () => {
    s.fake.seed('contract_request_files', [
      { id: 'f1', is_rejected: false, is_signed_contract: false },
    ]);
    expect(await s.repo.getFileRejection('f1')).toBe(false);
    await s.repo.setFileRejection('f1', true, 'u1');
    expect(s.fake.tableRows('contract_request_files')[0]!.is_rejected).toBe(true);
    await s.repo.setSignedContract('f1', true);
    expect(s.fake.tableRows('contract_request_files')[0]!.is_signed_contract).toBe(true);
  });

  it('statusCounts по кодам с фильтром контрагента', async () => {
    s.fake.seed('contract_requests', [
      { id: 'a', counterparty_id: 'cp1', status_id: 's-omts', is_deleted: false },
      { id: 'b', counterparty_id: 'cp1', status_id: 's-omts', is_deleted: false },
      { id: 'c', counterparty_id: 'cp1', status_id: 's-rev', is_deleted: false },
      { id: 'd', counterparty_id: 'cp2', status_id: 's-omts', is_deleted: false },
      { id: 'e', counterparty_id: 'cp1', status_id: 's-concl', is_deleted: true },
    ]);
    const counts = await s.repo.statusCounts({ counterpartyId: 'cp1' });
    expect(counts).toEqual({ approv_omts: 2, on_revision: 1, concluded: 0 });
  });

  it('statusCounts с пустым siteIds → нули', async () => {
    expect(await s.repo.statusCounts({ siteIds: [] })).toEqual({
      approv_omts: 0,
      on_revision: 0,
      concluded: 0,
    });
  });
});
