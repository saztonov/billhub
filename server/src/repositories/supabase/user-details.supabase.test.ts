/**
 * Unit-тесты расширений SupabaseUserRepository (Phase 2):
 * детали (контрагент + объекты), доступ к объектам, обновление с объектами
 * и авторезолвом уведомлений, привязки, создание профиля подрядчика.
 * Работают на FakeSupabase (in-memory), без Docker.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseUserRepository } from './user.supabase.js';
import { NotFoundError, ValidationError } from '../types.js';

function setup() {
  const fake = new FakeSupabase();
  const repo = new SupabaseUserRepository(fake as unknown as SupabaseClient);
  return { fake, repo };
}

function seedBase(fake: FakeSupabase) {
  fake.seed('counterparties', [{ id: 'cp1', name: 'ООО Ромашка' }]);
  fake.seed('construction_sites', [
    { id: 's1', name: 'Объект 1' },
    { id: 's2', name: 'Объект 2' },
  ]);
  fake.seed('users', [
    {
      id: 'u1',
      email: 'a@b.ru',
      full_name: 'Сотрудник',
      role: 'user',
      counterparty_id: null,
      department_id: 'omts',
      all_sites: false,
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'u2',
      email: 'c@b.ru',
      full_name: 'Подрядчик',
      role: 'counterparty_user',
      counterparty_id: 'cp1',
      department_id: null,
      all_sites: false,
      is_active: true,
      created_at: '2026-01-02T00:00:00.000Z',
    },
  ]);
  fake.seed('user_construction_sites_mapping', [
    { id: 'm1', user_id: 'u1', construction_site_id: 's1' },
  ]);
}

describe('SupabaseUserRepository — детали и объекты', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedBase(s.fake);
  });

  it('listWithDetails: имя контрагента и объекты', async () => {
    const list = await s.repo.listWithDetails();
    const u1 = list.find((u) => u.id === 'u1')!;
    const u2 = list.find((u) => u.id === 'u2')!;
    expect(u1.siteIds).toEqual(['s1']);
    expect(u1.siteNames).toEqual(['Объект 1']);
    expect(u1.department).toBe('omts');
    expect(u1.counterpartyName).toBeNull();
    expect(u2.counterpartyName).toBe('ООО Ромашка');
  });

  it('getWithDetails: один пользователь; несуществующий → NotFound', async () => {
    const u = await s.repo.getWithDetails('u1');
    expect(u.siteNames).toEqual(['Объект 1']);
    await expect(s.repo.getWithDetails('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('getSiteAccess: allSites + siteIds; NotFound', async () => {
    expect(await s.repo.getSiteAccess('u1')).toEqual({ allSites: false, siteIds: ['s1'] });
    await expect(s.repo.getSiteAccess('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('getSiteMappingIds', async () => {
    expect(await s.repo.getSiteMappingIds('u1')).toEqual([{ constructionSiteId: 's1' }]);
  });

  it('setSiteMappings заменяет привязки', async () => {
    await s.repo.setSiteMappings('u1', ['s2']);
    expect(await s.repo.getSiteMappingIds('u1')).toEqual([{ constructionSiteId: 's2' }]);
    await s.repo.setSiteMappings('u1', []);
    expect(await s.repo.getSiteMappingIds('u1')).toEqual([]);
  });

  it('createCounterpartyUserRecord добавляет профиль', async () => {
    await s.repo.createCounterpartyUserRecord({
      id: 'u3',
      email: 'd@b.ru',
      fullName: 'Новый',
      counterpartyId: 'cp1',
    });
    const u = await s.repo.getById('u3');
    expect(u.role).toBe('counterparty_user');
    expect(u.counterpartyId).toBe('cp1');
  });
});

describe('SupabaseUserRepository — updateWithSites', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    seedBase(s.fake);
  });

  it('Штаб без allSites требует 1-2 объекта (ValidationError)', async () => {
    await expect(
      s.repo.updateWithSites('u1', {
        fullName: 'X',
        role: 'user',
        counterpartyId: null,
        department: 'shtab',
        allSites: false,
        siteIds: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      s.repo.updateWithSites('u1', {
        fullName: 'X',
        role: 'user',
        counterpartyId: null,
        department: 'shtab',
        allSites: false,
        siteIds: ['s1', 's2', 'sX'],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('обновляет поля и переустанавливает привязки', async () => {
    await s.repo.updateWithSites('u1', {
      fullName: 'Новое имя',
      role: 'user',
      counterpartyId: null,
      department: 'shtab',
      allSites: false,
      siteIds: ['s2'],
    });
    const u = await s.repo.getWithDetails('u1');
    expect(u.fullName).toBe('Новое имя');
    expect(u.siteIds).toEqual(['s2']);
  });

  it('counterparty_user сбрасывает департамент и привязки', async () => {
    await s.repo.updateWithSites('u1', {
      fullName: 'П',
      role: 'counterparty_user',
      counterpartyId: 'cp1',
      department: 'omts',
      allSites: true,
      siteIds: ['s1'],
    });
    const u = await s.repo.getWithDetails('u1');
    expect(u.department).toBeNull();
    expect(u.allSites).toBe(false);
    expect(u.siteIds).toEqual([]);
    expect(u.counterpartyId).toBe('cp1');
  });

  it('авторезолв уведомлений missing_specialist по совпадению объекта', async () => {
    s.fake.seed('notifications', [
      {
        id: 'n1',
        type: 'missing_specialist',
        department_id: 'omts',
        site_id: 's2',
        resolved: false,
        resolved_at: null,
      },
      {
        id: 'n2',
        type: 'missing_specialist',
        department_id: 'omts',
        site_id: 's1',
        resolved: false,
        resolved_at: null,
      },
    ]);
    await s.repo.updateWithSites('u1', {
      fullName: 'X',
      role: 'user',
      counterpartyId: null,
      department: 'omts',
      allSites: false,
      siteIds: ['s2'],
    });
    const notifs = s.fake.tableRows('notifications');
    expect(notifs.find((n) => n.id === 'n1')!.resolved).toBe(true);
    expect(notifs.find((n) => n.id === 'n2')!.resolved).toBe(false);
  });
});
