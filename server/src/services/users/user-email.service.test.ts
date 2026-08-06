/**
 * Тесты смены логина администратором (UserEmailService).
 *
 * Ключевые инварианты: изменение регистра — не смена; предусловие expected_email;
 * регистронезависимая уникальность; запрет в supabase-bridge; saga Keycloak
 * (обновление → локальная запись → logout, компенсация при сбое БД).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserEmailService, type KeycloakEmailPort } from './user-email.service.js';
import { InMemoryUserRepository } from '../../test/repositories/in-memory.js';
import { InMemoryIdentityLinkStore } from '../auth/stores/memory.js';
import { RecordingAuditLogger } from '../auth/audit.js';
import { ConflictError, UniqueConstraintError, ValidationError } from '../../repositories/types.js';
import type { AuthMode } from '../../plugins/auth.js';
import type { User } from '../../schemas/user.js';

const ADMIN = { id: 'admin-1', email: 'admin@su10.ru' };
const USER_ID = '11111111-1111-1111-1111-111111111111';
const HMAC_KEY = 'test-audit-key';

function makeUser(email: string): User {
  return {
    id: USER_ID,
    email,
    fullName: 'Иванов Иван',
    role: 'user',
    counterpartyId: null,
    department: null,
    allSites: false,
    isActive: true,
  };
}

const PROFILE = {
  fullName: 'Иванов Иван',
  role: 'user' as const,
  counterpartyId: null,
  department: null,
  allSites: false,
  siteIds: [] as string[],
};

/** Фейк Keycloak Admin API: хранит username/email по subject. */
function makeKeycloak(initial: Record<string, { username: string; email: string }> = {}) {
  const users = new Map(Object.entries(initial));
  const calls = { logout: [] as string[], updates: [] as { id: string; email: string }[] };
  const port: KeycloakEmailPort = {
    async updateUserEmail(id, email) {
      const existing = users.get(id);
      const preimage = existing ? { ...existing, emailVerified: true } : {};
      users.set(id, { username: email, email });
      calls.updates.push({ id, email });
      return preimage;
    },
    async logoutAllSessions(id) {
      calls.logout.push(id);
    },
    async findUserByEmail(email) {
      for (const [id, u] of users) {
        if (u.email.toLowerCase() === email.toLowerCase()) return { id };
      }
      return null;
    },
    async getUserById(id) {
      const u = users.get(id);
      return u ? { id, ...u } : null;
    },
  };
  return { port, users, calls };
}

function makeService(opts: {
  repo: InMemoryUserRepository;
  authMode?: AuthMode;
  keycloak?: KeycloakEmailPort;
  links?: InMemoryIdentityLinkStore;
  audit?: RecordingAuditLogger;
  invalidate?: (id: string) => void;
}) {
  const audit = opts.audit ?? new RecordingAuditLogger();
  return new UserEmailService({
    users: opts.repo,
    authMode: opts.authMode ?? 'standalone',
    identityLinks: opts.links ?? new InMemoryIdentityLinkStore(),
    identityProvider: 'keycloak-local',
    keycloak: opts.keycloak ?? makeKeycloak().port,
    audit,
    auditHmacKey: HMAC_KEY,
    log: { warn: () => {}, error: () => {} },
    invalidateUserCache: opts.invalidate ?? (() => {}),
  });
}

describe('UserEmailService — standalone', () => {
  let repo: InMemoryUserRepository;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
    repo.seed([makeUser('ivanov@su10.ru')]);
  });

  it('меняет email и отдаёт emailChanged=true', async () => {
    const audit = new RecordingAuditLogger();
    const service = makeService({ repo, audit });

    const res = await service.updateProfile(ADMIN, USER_ID, {
      profile: PROFILE,
      email: 'petrov@su10.ru',
      expectedEmail: 'ivanov@su10.ru',
    });

    expect(res.emailChanged).toBe(true);
    expect((await repo.getById(USER_ID)).email).toBe('petrov@su10.ru');
    const event = audit.events.find((e) => e.event === 'email_change');
    expect(event).toBeDefined();
    expect(event?.fields.targetId).toBe(USER_ID);
    // В audit только HMAC — сырых адресов быть не должно.
    expect(audit.serialized()).not.toContain('petrov@su10.ru');
    expect(audit.serialized()).not.toContain('ivanov@su10.ru');
  });

  it('изменение только регистра — не смена: email в БД не трогается, audit пуст', async () => {
    const audit = new RecordingAuditLogger();
    const service = makeService({ repo, audit });

    const res = await service.updateProfile(ADMIN, USER_ID, {
      profile: PROFILE,
      email: 'ivanov@su10.ru',
      expectedEmail: 'IVANOV@su10.ru',
    });

    expect(res.emailChanged).toBe(false);
    expect((await repo.getById(USER_ID)).email).toBe('ivanov@su10.ru');
    expect(audit.events).toHaveLength(0);
  });

  it('тело без email обновляет только профиль', async () => {
    const service = makeService({ repo });
    const res = await service.updateProfile(ADMIN, USER_ID, {
      profile: { ...PROFILE, fullName: 'Петров Пётр' },
    });

    expect(res.emailChanged).toBe(false);
    const user = await repo.getById(USER_ID);
    expect(user.fullName).toBe('Петров Пётр');
    expect(user.email).toBe('ivanov@su10.ru');
  });

  it('устаревшая карточка (expected_email не совпал) → ConflictError, данные не меняются', async () => {
    const service = makeService({ repo });

    await expect(
      service.updateProfile(ADMIN, USER_ID, {
        profile: PROFILE,
        email: 'petrov@su10.ru',
        expectedEmail: 'stale@su10.ru',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.getById(USER_ID)).email).toBe('ivanov@su10.ru');
  });

  it('занятый адрес в другом регистре → UniqueConstraintError', async () => {
    repo.seed([makeUser('ivanov@su10.ru'), { ...makeUser('SIDOROV@su10.ru'), id: 'user-2' }]);
    const service = makeService({ repo });

    await expect(
      service.updateProfile(ADMIN, USER_ID, {
        profile: PROFILE,
        email: 'sidorov@su10.ru',
        expectedEmail: 'ivanov@su10.ru',
      }),
    ).rejects.toBeInstanceOf(UniqueConstraintError);
  });

  it('сбрасывает кеш профиля', async () => {
    const invalidate = vi.fn();
    const service = makeService({ repo, invalidate });

    await service.updateProfile(ADMIN, USER_ID, {
      profile: PROFILE,
      email: 'petrov@su10.ru',
      expectedEmail: 'ivanov@su10.ru',
    });

    expect(invalidate).toHaveBeenCalledWith(USER_ID);
  });
});

describe('UserEmailService — supabase-bridge', () => {
  it('смена email запрещена (логин живёт в Supabase Auth)', async () => {
    const repo = new InMemoryUserRepository();
    repo.seed([makeUser('ivanov@su10.ru')]);
    const service = makeService({ repo, authMode: 'supabase-bridge' });

    await expect(
      service.updateProfile(ADMIN, USER_ID, {
        profile: PROFILE,
        email: 'petrov@su10.ru',
        expectedEmail: 'ivanov@su10.ru',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await repo.getById(USER_ID)).email).toBe('ivanov@su10.ru');
  });

  it('обновление профиля без смены email продолжает работать', async () => {
    const repo = new InMemoryUserRepository();
    repo.seed([makeUser('ivanov@su10.ru')]);
    const service = makeService({ repo, authMode: 'supabase-bridge' });

    const res = await service.updateProfile(ADMIN, USER_ID, {
      profile: { ...PROFILE, fullName: 'Петров Пётр' },
    });

    expect(res.emailChanged).toBe(false);
    expect((await repo.getById(USER_ID)).fullName).toBe('Петров Пётр');
  });
});

describe('UserEmailService — keycloak', () => {
  let repo: InMemoryUserRepository;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
    repo.seed([makeUser('ivanov@su10.ru')]);
  });

  function linkedStore() {
    return new InMemoryIdentityLinkStore([
      {
        id: 'link-1',
        userId: USER_ID,
        provider: 'keycloak-local',
        subject: 'kc-sub-1',
        emailAtLink: 'ivanov@su10.ru',
        linkedAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: null,
      },
    ]);
  }

  it('обновляет username/email в KC и завершает сессии', async () => {
    const kc = makeKeycloak({
      'kc-sub-1': { username: 'ivanov@su10.ru', email: 'ivanov@su10.ru' },
    });
    const service = makeService({
      repo,
      authMode: 'keycloak',
      keycloak: kc.port,
      links: linkedStore(),
    });

    await service.updateProfile(ADMIN, USER_ID, {
      profile: PROFILE,
      email: 'petrov@su10.ru',
      expectedEmail: 'ivanov@su10.ru',
    });

    expect(kc.users.get('kc-sub-1')).toEqual({
      username: 'petrov@su10.ru',
      email: 'petrov@su10.ru',
    });
    expect(kc.calls.logout).toEqual(['kc-sub-1']);
    expect((await repo.getById(USER_ID)).email).toBe('petrov@su10.ru');
  });

  it('без link ищет пользователя в KC по текущему адресу', async () => {
    const kc = makeKeycloak({
      'kc-sub-9': { username: 'ivanov@su10.ru', email: 'ivanov@su10.ru' },
    });
    const service = makeService({ repo, authMode: 'keycloak', keycloak: kc.port });

    await service.updateProfile(ADMIN, USER_ID, {
      profile: PROFILE,
      email: 'petrov@su10.ru',
      expectedEmail: 'ivanov@su10.ru',
    });

    expect(kc.users.get('kc-sub-9')?.email).toBe('petrov@su10.ru');
  });

  it('нет идентичности в KC → ConflictError, локальные данные не меняются', async () => {
    const kc = makeKeycloak();
    const service = makeService({ repo, authMode: 'keycloak', keycloak: kc.port });

    await expect(
      service.updateProfile(ADMIN, USER_ID, {
        profile: PROFILE,
        email: 'petrov@su10.ru',
        expectedEmail: 'ivanov@su10.ru',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.getById(USER_ID)).email).toBe('ivanov@su10.ru');
  });

  it('сбой локальной транзакции → компенсация возвращает прежний адрес в KC', async () => {
    const kc = makeKeycloak({
      'kc-sub-1': { username: 'ivanov@su10.ru', email: 'ivanov@su10.ru' },
    });
    const audit = new RecordingAuditLogger();
    vi.spyOn(repo, 'updateWithSites').mockRejectedValueOnce(new Error('db down'));
    const service = makeService({
      repo,
      authMode: 'keycloak',
      keycloak: kc.port,
      links: linkedStore(),
      audit,
    });

    await expect(
      service.updateProfile(ADMIN, USER_ID, {
        profile: PROFILE,
        email: 'petrov@su10.ru',
        expectedEmail: 'ivanov@su10.ru',
      }),
    ).rejects.toThrow('db down');

    expect(kc.users.get('kc-sub-1')).toEqual({
      username: 'ivanov@su10.ru',
      email: 'ivanov@su10.ru',
    });
    expect(kc.calls.logout).toEqual([]);
  });

  it('внешнее изменение в KC отменяет компенсацию и фиксируется в audit', async () => {
    const kc = makeKeycloak({
      'kc-sub-1': { username: 'ivanov@su10.ru', email: 'ivanov@su10.ru' },
    });
    const audit = new RecordingAuditLogger();
    vi.spyOn(repo, 'updateWithSites').mockImplementationOnce(async () => {
      // Пока шла запись в БД, KC-запись изменил кто-то ещё.
      kc.users.set('kc-sub-1', { username: 'other@su10.ru', email: 'other@su10.ru' });
      throw new Error('db down');
    });
    const service = makeService({
      repo,
      authMode: 'keycloak',
      keycloak: kc.port,
      links: linkedStore(),
      audit,
    });

    await expect(
      service.updateProfile(ADMIN, USER_ID, {
        profile: PROFILE,
        email: 'petrov@su10.ru',
        expectedEmail: 'ivanov@su10.ru',
      }),
    ).rejects.toThrow('db down');

    expect(kc.users.get('kc-sub-1')?.email).toBe('other@su10.ru');
    const failure = audit.events.find((e) => e.event === 'identity_sync_failed');
    expect(failure?.fields.reason).toBe('compensation_skipped_external_change');
  });

  it('сбой logout не отменяет смену, но пишет identity_sync_failed', async () => {
    const kc = makeKeycloak({
      'kc-sub-1': { username: 'ivanov@su10.ru', email: 'ivanov@su10.ru' },
    });
    kc.port.logoutAllSessions = async () => {
      throw new Error('kc unavailable');
    };
    const audit = new RecordingAuditLogger();
    const service = makeService({
      repo,
      authMode: 'keycloak',
      keycloak: kc.port,
      links: linkedStore(),
      audit,
    });

    const res = await service.updateProfile(ADMIN, USER_ID, {
      profile: PROFILE,
      email: 'petrov@su10.ru',
      expectedEmail: 'ivanov@su10.ru',
    });

    expect(res.emailChanged).toBe(true);
    expect((await repo.getById(USER_ID)).email).toBe('petrov@su10.ru');
    const failure = audit.events.find((e) => e.event === 'identity_sync_failed');
    expect(failure?.fields.reason).toBe('logout_failed');
  });
});
