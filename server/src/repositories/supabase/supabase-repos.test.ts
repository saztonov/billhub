/**
 * Unit-тесты Supabase-адаптеров на in-memory фейке Supabase-клиента.
 * Покрывают snake↔camel маппинг, трансляцию ошибок PG (23505/23503/PGRST116) и list через RPC.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseCounterpartyRepository } from './counterparty.supabase.js';
import { SupabaseSupplierRepository } from './supplier.supabase.js';
import { SupabaseUserRepository } from './user.supabase.js';
import { NotFoundError, UniqueConstraintError, ForeignKeyConstraintError } from '../types.js';

function asClient(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

describe('SupabaseCounterpartyRepository (fake)', () => {
  let fake: FakeSupabase;
  let repo: SupabaseCounterpartyRepository;
  beforeEach(() => {
    fake = new FakeSupabase();
    repo = new SupabaseCounterpartyRepository(asClient(fake));
  });

  it('create + findById/getById маппит snake→camel', async () => {
    const created = await repo.create({ name: 'ООО Ромашка', inn: '7710140679' });
    expect(created.name).toBe('ООО Ромашка');
    expect(created.address).toBe('');
    expect(created.alternativeNames).toEqual([]);
    const fetched = await repo.getById(created.id);
    expect(fetched.id).toBe(created.id);
    expect(await repo.findById('missing')).toBeNull();
  });

  it('getById бросает NotFoundError', async () => {
    await expect(repo.getById('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('findByInn', async () => {
    await repo.create({ name: 'A', inn: '7710140679' });
    expect((await repo.findByInn('7710140679'))?.inn).toBe('7710140679');
    expect(await repo.findByInn('5001007322')).toBeNull();
  });

  it('create с дублем ИНН → UniqueConstraintError', async () => {
    await repo.create({ name: 'A', inn: '7710140679' });
    await expect(repo.create({ name: 'B', inn: '7710140679' })).rejects.toBeInstanceOf(
      UniqueConstraintError,
    );
  });

  it('update меняет поля; update несуществующего → NotFoundError', async () => {
    const c = await repo.create({ name: 'A', inn: '7710140679' });
    const upd = await repo.update(c.id, { name: 'B' });
    expect(upd.name).toBe('B');
    expect(upd.inn).toBe('7710140679');
    await expect(repo.update('missing', { name: 'X' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('update с конфликтом ИНН → UniqueConstraintError', async () => {
    const a = await repo.create({ name: 'A', inn: '7710140679' });
    await repo.create({ name: 'B', inn: '5001007322' });
    await expect(repo.update(a.id, { inn: '5001007322' })).rejects.toBeInstanceOf(
      UniqueConstraintError,
    );
  });

  it('delete существующего; delete несуществующего → NotFoundError; FK → ForeignKeyConstraintError', async () => {
    const c = await repo.create({ name: 'A', inn: '7710140679' });
    await repo.delete(c.id);
    expect(await repo.findById(c.id)).toBeNull();
    await expect(repo.delete('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const c2 = await repo.create({ name: 'B', inn: '5001007322' });
    fake.setFkViolation('counterparties');
    await expect(repo.delete(c2.id)).rejects.toBeInstanceOf(ForeignKeyConstraintError);
  });

  it('list через RPC list_counterparties_with_sb маппит агрегаты и totalCount', async () => {
    fake.setRpcResult('list_counterparties_with_sb', [
      {
        id: 'id-1',
        name: 'Альфа',
        inn: '7710140679',
        address: 'addr',
        alternative_names: ['Прометей'],
        registration_token: null,
        created_at: '2026-01-01T00:00:00.000Z',
        last_security_status: 'approved',
        has_pending_request: true,
        total_count: 5,
      },
    ]);
    const res = await repo.list({ page: 1, pageSize: 10, sbFilter: 'all' });
    expect(res.totalCount).toBe(5);
    expect(res.items[0]?.lastSecurityStatus).toBe('approved');
    expect(res.items[0]?.hasPendingRequest).toBe(true);
    expect(res.items[0]?.alternativeNames).toEqual(['Прометей']);
  });

  it('list возвращает пусто на пустом RPC', async () => {
    fake.setRpcResult('list_counterparties_with_sb', []);
    const res = await repo.list({ page: 1, pageSize: 10, sbFilter: 'all' });
    expect(res).toEqual({ items: [], totalCount: 0 });
  });
});

describe('SupabaseSupplierRepository (fake)', () => {
  let fake: FakeSupabase;
  let repo: SupabaseSupplierRepository;
  beforeEach(() => {
    fake = new FakeSupabase();
    repo = new SupabaseSupplierRepository(asClient(fake));
  });

  it('CRUD + уникальность ИНН', async () => {
    const s = await repo.create({ name: 'Поставщик', inn: '7710140679' });
    expect(s.lastSecurityStatus).toBeNull();
    expect((await repo.getById(s.id)).id).toBe(s.id);
    expect((await repo.findByInn('7710140679'))?.id).toBe(s.id);
    await expect(repo.create({ name: 'Дубль', inn: '7710140679' })).rejects.toBeInstanceOf(
      UniqueConstraintError,
    );
  });

  it('update foundingDocumentsComment; delete существующего/несуществующего; FK', async () => {
    const s = await repo.create({ name: 'A', inn: '7710140679' });
    const upd = await repo.update(s.id, { foundingDocumentsComment: 'комментарий' });
    expect(upd.foundingDocumentsComment).toBe('комментарий');
    const s2 = await repo.create({ name: 'B', inn: '5001007322' });
    await repo.delete(s2.id);
    expect(await repo.findById(s2.id)).toBeNull();
    await expect(repo.delete('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    fake.setFkViolation('suppliers');
    await expect(repo.delete(s.id)).rejects.toBeInstanceOf(ForeignKeyConstraintError);
  });

  it('update несуществующего → NotFoundError', async () => {
    await expect(repo.update('missing', { name: 'X' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('list через RPC list_suppliers_with_sb', async () => {
    fake.setRpcResult('list_suppliers_with_sb', [
      {
        id: 's-1',
        name: 'Пост',
        inn: '7710140679',
        alternative_names: [],
        created_at: '2026-01-01T00:00:00.000Z',
        last_security_status: 'rejected',
        has_pending_request: false,
        total_count: 3,
      },
    ]);
    const res = await repo.list({ page: 1, pageSize: 10, sbFilter: 'all' });
    expect(res.totalCount).toBe(3);
    expect(res.items[0]?.lastSecurityStatus).toBe('rejected');
  });
});

describe('SupabaseUserRepository (fake)', () => {
  let fake: FakeSupabase;
  let repo: SupabaseUserRepository;
  beforeEach(() => {
    fake = new FakeSupabase();
    // В реальной БД нет UNIQUE на email — для проверки ветки 23505→email включаем явно.
    fake.setUnique('users', [['email']]);
    repo = new SupabaseUserRepository(asClient(fake));
  });

  it('create + getById + findByEmail', async () => {
    const u = await repo.create({
      email: 'a@b.ru',
      password: 'password1',
      fullName: 'Иванов',
      role: 'user',
    });
    expect(u.email).toBe('a@b.ru');
    expect(u.fullName).toBe('Иванов');
    expect(u.role).toBe('user');
    expect((await repo.getById(u.id)).id).toBe(u.id);
    expect((await repo.findByEmail('a@b.ru'))?.id).toBe(u.id);
    expect(await repo.findByEmail('none@b.ru')).toBeNull();
  });

  it('create с дублем email → UniqueConstraintError', async () => {
    await repo.create({ email: 'a@b.ru', password: 'password1', fullName: 'A', role: 'user' });
    await expect(
      repo.create({ email: 'a@b.ru', password: 'password1', fullName: 'B', role: 'user' }),
    ).rejects.toBeInstanceOf(UniqueConstraintError);
  });

  it('update + setActive; update несуществующего → NotFoundError', async () => {
    const u = await repo.create({
      email: 'a@b.ru',
      password: 'password1',
      fullName: 'A',
      role: 'user',
    });
    const upd = await repo.update(u.id, { fullName: 'Б' });
    expect(upd.fullName).toBe('Б');
    const deact = await repo.setActive(u.id, false);
    expect(deact.isActive).toBe(false);
    await expect(repo.update('missing', { fullName: 'X' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('list с фильтрами и пагинацией', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create({
        email: `u${i}@b.ru`,
        password: 'password1',
        fullName: i % 2 === 0 ? `Альфа ${i}` : `Бета ${i}`,
        role: i === 0 ? 'admin' : 'user',
      });
    }
    const all = await repo.list({ page: 1, pageSize: 10 });
    expect(all.totalCount).toBe(5);
    const admins = await repo.list({ page: 1, pageSize: 10, role: 'admin' });
    expect(admins.totalCount).toBe(1);
    const search = await repo.list({ page: 1, pageSize: 10, search: 'Альфа' });
    expect(search.items.every((u) => u.fullName.includes('Альфа'))).toBe(true);
    const page1 = await repo.list({ page: 1, pageSize: 2 });
    expect(page1.items.length).toBe(2);
  });

  it('delete удаляет пользователя; delete несуществующего → NotFoundError', async () => {
    const u = await repo.create({
      email: 'a@b.ru',
      password: 'password1',
      fullName: 'A',
      role: 'user',
    });
    await repo.delete(u.id);
    expect(await repo.findById(u.id)).toBeNull();
    await expect(repo.delete('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
