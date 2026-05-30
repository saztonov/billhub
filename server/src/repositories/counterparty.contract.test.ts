/**
 * Контрактный тест CounterpartyRepository — на in-memory реализации.
 *
 * Та же сюита прогоняется на любой реализации (Supabase, Drizzle, in-memory):
 * это гарантирует, что переход с Supabase на Drizzle (Iteration 4–5) не меняет
 * наблюдаемое поведение.
 *
 * SupabaseRepository не покрыт этим контрактом потому, что требует реальный
 * Supabase-инстанс. В Iteration 4 будет добавлен прогон контракта против Drizzle-impl
 * через testcontainers PG.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryCounterpartyRepository } from '../test/repositories/in-memory.js';
import { NotFoundError, UniqueConstraintError } from './types.js';
import type { Counterparty } from '../schemas/counterparty.js';

describe('CounterpartyRepository contract (in-memory)', () => {
  let repo: InMemoryCounterpartyRepository;

  beforeEach(() => {
    repo = new InMemoryCounterpartyRepository();
  });

  describe('CRUD', () => {
    it('create + getById возвращает созданный объект', async () => {
      const created = await repo.create({ name: 'ООО Ромашка', inn: '7710140679' });
      const fetched = await repo.getById(created.id);
      expect(fetched).toEqual(created);
    });

    it('getById бросает NotFoundError для несуществующего id', async () => {
      await expect(repo.getById('missing')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('findById возвращает null для несуществующего id', async () => {
      const result = await repo.findById('missing');
      expect(result).toBeNull();
    });

    it('findByInn возвращает контрагента по ИНН', async () => {
      await repo.create({ name: 'Test', inn: '7710140679' });
      const found = await repo.findByInn('7710140679');
      expect(found?.inn).toBe('7710140679');
    });

    it('findByInn возвращает null для отсутствующего ИНН', async () => {
      expect(await repo.findByInn('5001007322')).toBeNull();
    });

    it('create с дублирующимся ИНН бросает UniqueConstraintError', async () => {
      await repo.create({ name: 'A', inn: '7710140679' });
      await expect(repo.create({ name: 'B', inn: '7710140679' })).rejects.toBeInstanceOf(
        UniqueConstraintError,
      );
    });

    it('update меняет только переданные поля', async () => {
      const c = await repo.create({ name: 'A', inn: '7710140679' });
      const updated = await repo.update(c.id, { name: 'B' });
      expect(updated.name).toBe('B');
      expect(updated.inn).toBe('7710140679');
    });

    it('update несуществующего id бросает NotFoundError', async () => {
      await expect(repo.update('missing', { name: 'X' })).rejects.toBeInstanceOf(NotFoundError);
    });

    it('update с конфликтом ИНН бросает UniqueConstraintError', async () => {
      const a = await repo.create({ name: 'A', inn: '7710140679' });
      await repo.create({ name: 'B', inn: '5001007322' });
      await expect(repo.update(a.id, { inn: '5001007322' })).rejects.toBeInstanceOf(
        UniqueConstraintError,
      );
    });

    it('delete удаляет', async () => {
      const c = await repo.create({ name: 'A', inn: '7710140679' });
      await repo.delete(c.id);
      expect(await repo.findById(c.id)).toBeNull();
    });

    it('delete несуществующего id бросает NotFoundError', async () => {
      await expect(repo.delete('missing')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('list — пагинация + фильтры', () => {
    beforeEach(() => {
      const items: Counterparty[] = Array.from({ length: 25 }, (_, i) => ({
        id: `id-${i}`,
        name: i % 3 === 0 ? `Альфа ${i}` : `Бета ${i}`,
        inn: String(1000000000 + i),
        address: '',
        alternativeNames: i === 5 ? ['Прометей'] : [],
        registrationToken: null,
        createdAt: new Date(2026, 0, 1 + i).toISOString(),
        hasPendingRequest: i === 7 || i === 8,
      }));
      repo.seed(items);
    });

    it('возвращает первую страницу с totalCount', async () => {
      const result = await repo.list({ page: 1, pageSize: 10, sbFilter: 'all' });
      expect(result.items.length).toBe(10);
      expect(result.totalCount).toBe(25);
    });

    it('вторая страница смещена на pageSize', async () => {
      const page1 = await repo.list({ page: 1, pageSize: 10, sbFilter: 'all' });
      const page2 = await repo.list({ page: 2, pageSize: 10, sbFilter: 'all' });
      expect(page1.items[0]?.id).not.toBe(page2.items[0]?.id);
    });

    it('search фильтрует по name', async () => {
      const result = await repo.list({ page: 1, pageSize: 50, sbFilter: 'all', search: 'Альфа' });
      expect(result.items.every((c) => c.name.includes('Альфа'))).toBe(true);
    });

    it('search фильтрует по alternativeNames', async () => {
      const result = await repo.list({
        page: 1,
        pageSize: 50,
        sbFilter: 'all',
        search: 'Прометей',
      });
      expect(result.items.length).toBe(1);
    });

    it('sbFilter=pending показывает только заявки в работе', async () => {
      const result = await repo.list({ page: 1, pageSize: 50, sbFilter: 'pending' });
      expect(result.totalCount).toBe(2);
      expect(result.items.every((c) => c.hasPendingRequest)).toBe(true);
    });

    it('onlyCounterpartyId возвращает ровно одного', async () => {
      const result = await repo.list({
        page: 1,
        pageSize: 50,
        sbFilter: 'all',
        onlyCounterpartyId: 'id-3',
      });
      expect(result.items.length).toBe(1);
      expect(result.items[0]?.id).toBe('id-3');
    });
  });
});
