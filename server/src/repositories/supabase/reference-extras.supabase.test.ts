/**
 * Unit-тесты новых Supabase-репозиториев Iteration 5 (Phase 1):
 *  - SupabaseReferenceRepository (объекты/виды затрат/типы документов/статусы);
 *  - расширения SupabaseCounterpartyRepository (listAll, batchCreate);
 *  - расширения SupabaseSupplierRepository (listAll, batchCreate, listForApi,
 *    getSecurityHistory, requestSecurityCheck, decideSecurityCheck).
 *
 * Работают на FakeSupabase (in-memory), без Docker.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseReferenceRepository } from './reference.supabase.js';
import { SupabaseCounterpartyRepository } from './counterparty.supabase.js';
import { SupabaseSupplierRepository } from './supplier.supabase.js';
import { NotFoundError, ConflictError, ValidationError } from '../types.js';

function makeRepos() {
  const fake = new FakeSupabase();
  const client = fake as unknown as SupabaseClient;
  return {
    fake,
    references: new SupabaseReferenceRepository(client),
    counterparties: new SupabaseCounterpartyRepository(client),
    suppliers: new SupabaseSupplierRepository(client),
  };
}

describe('SupabaseReferenceRepository', () => {
  let r: ReturnType<typeof makeRepos>;
  beforeEach(() => {
    r = makeRepos();
  });

  describe('construction sites', () => {
    it('create + get + list', async () => {
      const s = await r.references.createConstructionSite({ name: 'Объект 1' });
      expect(s.name).toBe('Объект 1');
      expect(s.isActive).toBe(true);
      expect((await r.references.getConstructionSite(s.id)).id).toBe(s.id);
      expect((await r.references.listConstructionSites()).length).toBe(1);
    });

    it('get несуществующего → NotFoundError', async () => {
      await expect(r.references.getConstructionSite('missing')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('update меняет поля; update несуществующего → NotFoundError', async () => {
      const s = await r.references.createConstructionSite({ name: 'A' });
      const upd = await r.references.updateConstructionSite(s.id, { name: 'B', isActive: false });
      expect(upd.name).toBe('B');
      expect(upd.isActive).toBe(false);
      await expect(
        r.references.updateConstructionSite('missing', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('delete; повторный delete → NotFoundError', async () => {
      const s = await r.references.createConstructionSite({ name: 'A' });
      await r.references.deleteConstructionSite(s.id);
      await expect(r.references.deleteConstructionSite(s.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('cost types', () => {
    it('create/update/delete/list + batch', async () => {
      const c = await r.references.createCostType({ name: 'Затрата' });
      expect(c.name).toBe('Затрата');
      const upd = await r.references.updateCostType(c.id, { isActive: false });
      expect(upd.isActive).toBe(false);
      const created = await r.references.batchCreateCostTypes(['X', 'Y', 'Z']);
      expect(created).toBe(3);
      expect((await r.references.listCostTypes()).length).toBe(4);
      await r.references.deleteCostType(c.id);
      expect((await r.references.listCostTypes()).length).toBe(3);
    });
  });

  describe('document types', () => {
    it('create + list (фильтр category) + update + delete', async () => {
      await r.references.createDocumentType({ name: 'Акт', category: 'operational' });
      await r.references.createDocumentType({ name: 'Устав', category: 'founding' });
      expect((await r.references.listDocumentTypes()).length).toBe(2);
      expect((await r.references.listDocumentTypes('founding')).length).toBe(1);
      const all = await r.references.listDocumentTypes();
      const upd = await r.references.updateDocumentType(all[0]!.id, { name: 'Акт2' });
      expect(upd.name).toBe('Акт2');
      await r.references.deleteDocumentType(all[0]!.id);
      expect((await r.references.listDocumentTypes()).length).toBe(1);
    });
  });

  describe('statuses', () => {
    it('create + list by entityType + update + delete', async () => {
      await r.references.createStatus({
        entityType: 'payment_request',
        code: 'draft',
        name: 'Черновик',
      });
      await r.references.createStatus({
        entityType: 'contract_request',
        code: 'new',
        name: 'Новая',
      });
      const prStatuses = await r.references.listStatuses('payment_request');
      expect(prStatuses.length).toBe(1);
      expect(prStatuses[0]!.code).toBe('draft');
      const upd = await r.references.updateStatus(prStatuses[0]!.id, {
        name: 'Черновик2',
        displayOrder: 5,
      });
      expect(upd.name).toBe('Черновик2');
      expect(upd.displayOrder).toBe(5);
      await r.references.deleteStatus(prStatuses[0]!.id);
      expect((await r.references.listStatuses('payment_request')).length).toBe(0);
    });
  });
});

describe('SupabaseCounterpartyRepository (расширения Iteration 5)', () => {
  it('listAll + batchCreate', async () => {
    const r = makeRepos();
    const n = await r.counterparties.batchCreate([
      { name: 'A', inn: '7710140679' },
      { name: 'B', inn: '5001007322' },
    ]);
    expect(n).toBe(2);
    expect((await r.counterparties.listAll()).length).toBe(2);
  });
});

describe('SupabaseSupplierRepository (расширения Iteration 5)', () => {
  let r: ReturnType<typeof makeRepos>;
  beforeEach(() => {
    r = makeRepos();
  });

  it('listAll + batchCreate', async () => {
    const n = await r.suppliers.batchCreate([{ name: 'П1', inn: '7710140679' }]);
    expect(n).toBe(1);
    expect((await r.suppliers.listAll()).length).toBe(1);
  });

  it('listForApi маппит RPC-строки в форму ответа', async () => {
    r.fake.setRpcResult('list_suppliers_with_sb', [
      {
        id: 's1',
        name: 'П1',
        inn: '7710140679',
        alternative_names: [],
        created_at: '2026-01-01T00:00:00.000Z',
        last_security_status: 'approved',
        last_security_at: '2026-02-01T00:00:00.000Z',
        has_pending_request: false,
        total_count: 1,
      },
    ]);
    const res = await r.suppliers.listForApi({
      page: 1,
      pageSize: 20,
      sbFilter: 'all',
      cutoffDate: '2026-05-27',
    });
    expect(res.total).toBe(1);
    expect(res.items[0]!.lastSecurityCheck).toEqual({
      status: 'approved',
      createdAt: '2026-02-01T00:00:00.000Z',
    });
  });

  it('requestSecurityCheck: успех, повтор → Conflict, нет поставщика → NotFound', async () => {
    const s = await r.suppliers.create({ name: 'П', inn: '7710140679' });
    r.fake.seed('users', [{ id: 'sb1', role: 'security', is_active: true, full_name: 'СБ' }]);
    const ev = await r.suppliers.requestSecurityCheck(s.id, { id: 'u1', fullName: 'Иван' });
    expect(ev.eventType).toBe('requested');
    expect(ev.authorFullName).toBe('Иван');
    // уведомление security-пользователю создано
    expect(r.fake.tableRows('notifications').length).toBe(1);
    // повтор — уже на проверке
    await expect(
      r.suppliers.requestSecurityCheck(s.id, { id: 'u1', fullName: 'Иван' }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      r.suppliers.requestSecurityCheck('missing', { id: 'u1', fullName: 'Иван' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('decideSecurityCheck: rejected без комментария → Validation; approved обновляет last_security_status', async () => {
    const s = await r.suppliers.create({ name: 'П', inn: '7710140679' });
    await r.suppliers.requestSecurityCheck(s.id, { id: 'u1', fullName: 'Иван' });
    await expect(
      r.suppliers.decideSecurityCheck(
        s.id,
        { id: 'sb1', fullName: 'СБ' },
        { decision: 'rejected' },
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const ev = await r.suppliers.decideSecurityCheck(
      s.id,
      { id: 'sb1', fullName: 'СБ' },
      { decision: 'approved' },
    );
    expect(ev.eventType).toBe('approved');
    // денормализация last_security_status
    const sup = await r.suppliers.getById(s.id);
    expect(sup.lastSecurityStatus).toBe('approved');
    // уведомление инициатору запроса (u1)
    const decidedNotifs = r.fake
      .tableRows('notifications')
      .filter((n) => n.type === 'sb_review_decided');
    expect(decidedNotifs.length).toBe(1);
    expect(decidedNotifs[0]!.user_id).toBe('u1');
  });

  it('getSecurityHistory возвращает события с именами авторов', async () => {
    const s = await r.suppliers.create({ name: 'П', inn: '7710140679' });
    r.fake.seed('users', [{ id: 'u1', full_name: 'Иван', role: 'user', is_active: true }]);
    await r.suppliers.requestSecurityCheck(s.id, { id: 'u1', fullName: 'Иван' });
    const history = await r.suppliers.getSecurityHistory(s.id);
    expect(history.length).toBe(1);
    expect(history[0]!.authorFullName).toBe('Иван');
  });
});
