/** Ф1 — unit-тесты provider-agnostic резолва идентичности. */
import { describe, expect, it, vi } from 'vitest';
import { resolveKeycloakIdentity } from './identity-resolve.js';
import type { UserAuthRecord } from '../stores/types.js';

function rec(id: string): UserAuthRecord {
  return {
    id,
    email: `${id}@x.com`,
    role: 'user',
    counterpartyId: null,
    departmentId: null,
    allSites: false,
    fullName: 'U',
    isActive: true,
    passwordHash: null,
    passwordChangedAt: null,
  };
}

describe('resolveKeycloakIdentity', () => {
  it('1) резолвит по claim billhub_user_id (findById), без обращения к links', async () => {
    const users = { findById: vi.fn(async (id: string) => rec(id)) };
    const links = { findBySubject: vi.fn(async () => null) };
    const r = await resolveKeycloakIdentity(
      { users, links },
      { billhubUserId: 'u1', sub: 'kc-sub' },
    );
    expect(r).toEqual({ rec: rec('u1'), via: 'claim' });
    expect(links.findBySubject).not.toHaveBeenCalled();
  });

  it('2) при отсутствии claim — по (provider, subject) среди known-провайдеров', async () => {
    const users = { findById: vi.fn(async (id: string) => rec(id)) };
    const links = {
      findBySubject: vi.fn(async (provider: string) =>
        provider === 'keycloak-local' ? { userId: 'u2' } : null,
      ),
    };
    const r = await resolveKeycloakIdentity(
      { users, links },
      { billhubUserId: null, sub: 'kc-sub' },
    );
    expect(r?.via).toBe('link');
    expect(r?.provider).toBe('keycloak-local');
    expect(r?.rec.id).toBe('u2');
    // keycloak-ad проверяется первым (приоритет свежего провайдера).
    expect(links.findBySubject).toHaveBeenCalledWith('keycloak-ad', 'kc-sub');
  });

  it('claim есть, но пользователь не найден → падает на links', async () => {
    const users = {
      findById: vi.fn(async (id: string) => (id === 'missing' ? null : rec(id))),
    };
    const links = { findBySubject: vi.fn(async () => ({ userId: 'u3' })) };
    const r = await resolveKeycloakIdentity(
      { users, links },
      { billhubUserId: 'missing', sub: 'kc-sub' },
    );
    expect(r?.via).toBe('link');
    expect(r?.rec.id).toBe('u3');
  });

  it('ничего не найдено → null (email-fallback — забота callback)', async () => {
    const users = { findById: vi.fn(async () => null) };
    const links = { findBySubject: vi.fn(async () => null) };
    const r = await resolveKeycloakIdentity({ users, links }, { billhubUserId: null, sub: 's' });
    expect(r).toBeNull();
  });
});
