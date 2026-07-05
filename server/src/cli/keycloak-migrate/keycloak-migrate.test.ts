/**
 * Ф3 — unit-тесты CLI импорта (без Docker): чистое ядро + runners на моках портов.
 */
import { describe, expect, it } from 'vitest';
import { bcryptCost, buildBcryptCredential } from './bcrypt-credential.js';
import { splitFullName } from './name-split.js';
import { buildUserPayload } from './payload-builder.js';
import { analyzePreflight } from './preflight.js';
import { runImport, runPreflight, runReconcile, runVerify } from './runners.js';
import type {
  IfResourceExists,
  KcGroupRef,
  KcUserRef,
  KeycloakAdminPort,
  LinkStore,
  MigrationUser,
  MirrorWriter,
  PartialImportResultRaw,
  PartialImportUser,
  SourceReader,
} from './types.js';
import { emptyCounters, type Checkpoint, type MigrationState } from './types-state.js';

const NOW = () => '2026-07-05T00:00:00.000Z';
const HASH = '$2b$12$abcdefghijklmnopqrstuv0123456789012345678901234567890';

function user(over: Partial<MigrationUser> = {}): MigrationUser {
  return {
    id: over.id ?? '11111111-1111-1111-1111-111111111111',
    email: over.email ?? 'a@example.com',
    fullName: over.fullName ?? 'Иван Иванов',
    role: over.role ?? 'user',
    counterpartyId: over.counterpartyId ?? null,
    isActive: over.isActive ?? true,
    passwordHash: over.passwordHash === undefined ? HASH : over.passwordHash,
  };
}

/* ------------------------------- Моки портов -------------------------------- */

function mockSource(users: MigrationUser[]): SourceReader {
  return { readUsers: async () => users.map((u) => ({ ...u })) };
}

class MockLinks implements LinkStore {
  bySubject = new Map<string, string>(); // `${provider}:${subject}` -> userId
  byUser = new Map<string, string>(); // `${provider}:${userId}` -> subject
  async link(i: {
    userId: string;
    provider: string;
    subject: string;
    emailAtLink: string | null;
  }): Promise<string> {
    const k = `${i.provider}:${i.subject}`;
    if (!this.bySubject.has(k)) {
      this.bySubject.set(k, i.userId);
      this.byUser.set(`${i.provider}:${i.userId}`, i.subject);
    }
    return k;
  }
  async findBySubject(provider: string, subject: string): Promise<{ userId: string } | null> {
    const u = this.bySubject.get(`${provider}:${subject}`);
    return u ? { userId: u } : null;
  }
  async findSubjectByUserId(provider: string, userId: string): Promise<string | null> {
    return this.byUser.get(`${provider}:${userId}`) ?? null;
  }
}

interface MockKcOptions {
  /** email → KC-пользователь, возвращаемый после import (id = sub). По умолчанию id=users.id, attr выставлен. */
  resolve?: (email: string) => KcUserRef | null;
  groupsById?: Map<string, KcGroupRef[]>;
  importResult?: PartialImportResultRaw;
  failPartialImport?: boolean;
}

class MockKc implements KeycloakAdminPort {
  partialImportCalls = 0;
  merges: { id: string; attrs: Record<string, string[]> }[] = [];
  setActiveCalls: { userId: string; active: boolean }[] = [];
  usersById = new Map<string, KcUserRef>();
  groupsById: Map<string, KcGroupRef[]>;
  constructor(private readonly o: MockKcOptions = {}) {
    this.groupsById = o.groupsById ?? new Map();
  }
  async partialImport(
    _u: PartialImportUser[],
    _m: IfResourceExists,
  ): Promise<PartialImportResultRaw> {
    this.partialImportCalls += 1;
    if (this.o.failPartialImport) throw new Error('partialImport HTTP 500');
    return this.o.importResult ?? { added: _u.length, skipped: 0 };
  }
  async findUserByEmail(email: string): Promise<KcUserRef | null> {
    if (this.o.resolve) return this.o.resolve(email);
    return null;
  }
  async getUserById(id: string): Promise<KcUserRef | null> {
    return this.usersById.get(id) ?? null;
  }
  async getUserGroups(id: string): Promise<KcGroupRef[]> {
    return this.groupsById.get(id) ?? [];
  }
  async mergeUserAttributes(id: string, attrs: Record<string, string[]>): Promise<void> {
    this.merges.push({ id, attrs });
  }
  async setPortalActive(userId: string, active: boolean): Promise<void> {
    this.setActiveCalls.push({ userId, active });
  }
}

class MockCheckpoint implements Checkpoint {
  state: MigrationState | null = null;
  constructor(initial: MigrationState | null = null) {
    this.state = initial;
  }
  async load(): Promise<MigrationState | null> {
    return this.state;
  }
  async save(s: MigrationState): Promise<void> {
    this.state = JSON.parse(JSON.stringify(s)) as MigrationState;
  }
}

class MockMirror implements MirrorWriter {
  calls: { userId: string; active: boolean }[] = [];
  async setActive(userId: string, active: boolean): Promise<number> {
    this.calls.push({ userId, active });
    return 1;
  }
}

/** KC-юзер «как создал partialImport»: id=users.id, атрибут проставлен. */
function resolvedSelf(u: MigrationUser): KcUserRef {
  return { id: u.id, email: u.email, attributes: { billhub_user_id: [u.id] } };
}

/* --------------------------------- name-split ------------------------------ */

describe('splitFullName', () => {
  it('разбивает многословное ФИО, оба поля непустые', () => {
    expect(splitFullName('Иванов Иван Иванович')).toEqual({
      firstName: 'Иванов',
      lastName: 'Иван Иванович',
    });
  });
  it('одиночное имя → оба поля равны и непустые', () => {
    expect(splitFullName('Мадонна')).toEqual({ firstName: 'Мадонна', lastName: 'Мадонна' });
  });
  it('пусто → fallback, оба непустые', () => {
    expect(splitFullName('   ', 'john')).toEqual({ firstName: 'john', lastName: 'john' });
    expect(splitFullName('', '')).toEqual({ firstName: 'user', lastName: 'user' });
  });
  it('стабильно: тот же вход → тот же выход', () => {
    expect(splitFullName('ООО Ромашка')).toEqual(splitFullName('ООО   Ромашка'));
  });
});

/* ------------------------------ bcrypt-credential -------------------------- */

describe('bcrypt-credential', () => {
  it('извлекает cost из $2a/$2b/$2y', () => {
    expect(bcryptCost('$2a$12$' + 'x'.repeat(53))).toBe(12);
    expect(bcryptCost('$2y$10$' + 'x'.repeat(53))).toBe(10);
    expect(bcryptCost('not-a-hash')).toBeNull();
  });
  it('строит credential строго по контракту (JSON-строки, algorithm=bcrypt, без salt)', () => {
    const c = buildBcryptCredential(HASH);
    expect(c.type).toBe('password');
    expect(c.algorithm).toBe('bcrypt');
    expect(JSON.parse(c.secretData)).toEqual({ value: HASH });
    expect(JSON.parse(c.credentialData)).toEqual({ hashIterations: 12, algorithm: 'bcrypt' });
    expect(c.secretData).not.toContain('salt');
  });
  it('бросает на не-bcrypt', () => {
    expect(() => buildBcryptCredential('plain')).toThrow();
  });
});

/* -------------------------------- payload-builder -------------------------- */

describe('buildUserPayload', () => {
  it('обязательные поля + attribute billhub_user_id + credential при bcrypt', () => {
    const p = buildUserPayload(user());
    expect(p.id).toBe(user().id);
    expect(p.emailVerified).toBe(true);
    expect(p.enabled).toBe(true);
    expect(p.firstName).not.toBe('');
    expect(p.lastName).not.toBe('');
    expect(p.attributes.billhub_user_id).toEqual([user().id]);
    expect(p.attributes.full_name).toEqual(['Иван Иванов']);
    expect(p.credentials).toHaveLength(1);
  });
  it('null-хэш → без credentials', () => {
    const p = buildUserPayload(user({ passwordHash: null }));
    expect(p.credentials).toBeUndefined();
  });
  it('не-bcrypt хэш → без credentials', () => {
    const p = buildUserPayload(user({ passwordHash: 'plaintext' }));
    expect(p.credentials).toBeUndefined();
  });
});

/* --------------------------------- preflight ------------------------------- */

describe('analyzePreflight', () => {
  it('дубль lower(email) — blocker', () => {
    const r = analyzePreflight([
      user({ id: 'u1', email: 'A@x.com' }),
      user({ id: 'u2', email: 'a@x.com' }),
    ]);
    expect(r.anomalies.some((a) => a.kind === 'duplicate_email' && a.level === 'blocker')).toBe(
      true,
    );
  });
  it('null-хэш — warning, невалидный bcrypt — blocker', () => {
    const r = analyzePreflight([
      user({ id: 'u1', email: 'n@x.com', passwordHash: null }),
      user({ id: 'u2', email: 'b@x.com', passwordHash: 'md5xxx' }),
    ]);
    expect(r.anomalies.find((a) => a.kind === 'null_password')?.level).toBe('warning');
    expect(r.anomalies.find((a) => a.kind === 'invalid_bcrypt')?.level).toBe('blocker');
    expect(r.warnings).toBe(1);
  });
  it('инварианты role/counterparty и пустое имя — блокеры', () => {
    const r = analyzePreflight([
      user({ id: 'u1', email: 'r@x.com', role: 'viewer' }),
      user({ id: 'u2', email: 'c@x.com', role: 'counterparty_user', counterpartyId: null }),
      user({ id: 'u3', email: 'd@x.com', role: 'user', counterpartyId: 'cp1' }),
      user({ id: 'u4', email: 'e@x.com', fullName: '   ' }),
    ]);
    const kinds = r.anomalies.filter((a) => a.level === 'blocker').map((a) => a.kind);
    expect(kinds).toContain('invalid_role');
    expect(kinds).toContain('counterparty_missing');
    expect(kinds).toContain('counterparty_unexpected');
    expect(kinds).toContain('empty_name');
  });
});

/* --------------------------------- runImport ------------------------------- */

describe('runImport', () => {
  it('dry-run: ничего не пишет в KC/линки', async () => {
    const kc = new MockKc();
    const links = new MockLinks();
    const rep = await runImport({
      source: mockSource([user()]),
      kc,
      links,
      provider: 'keycloak-local',
      groupActive: 'billhub-active',
      groupPending: 'billhub-pending',
      dryRun: true,
      now: NOW,
    });
    expect(kc.partialImportCalls).toBe(0);
    expect(links.bySubject.size).toBe(0);
    expect(rep.counters.processed).toBe(1);
  });

  it('happy path: линк + группа active, sub=users.id', async () => {
    const u = user({ isActive: true });
    const kc = new MockKc({ resolve: () => resolvedSelf(u) });
    const links = new MockLinks();
    const rep = await runImport({
      source: mockSource([u]),
      kc,
      links,
      provider: 'keycloak-local',
      groupActive: 'billhub-active',
      groupPending: 'billhub-pending',
      now: NOW,
    });
    expect(rep.stopped).toBe(false);
    expect(rep.counters.linked).toBe(1);
    expect(rep.counters.active).toBe(1);
    expect(kc.setActiveCalls).toEqual([{ userId: u.id, active: true }]);
    expect(links.byUser.get(`keycloak-local:${u.id}`)).toBe(u.id);
    expect(kc.merges).toHaveLength(0); // атрибут уже был
  });

  it('SKIP пред-существующего с тем же id → backfill атрибута', async () => {
    const u = user();
    const kc = new MockKc({
      resolve: () => ({ id: u.id, email: u.email, attributes: {} }), // атрибут отсутствует
    });
    const links = new MockLinks();
    const rep = await runImport({
      source: mockSource([u]),
      kc,
      links,
      provider: 'keycloak-local',
      groupActive: 'billhub-active',
      groupPending: 'billhub-pending',
      now: NOW,
    });
    expect(kc.merges).toEqual([{ id: u.id, attrs: { billhub_user_id: [u.id] } }]);
    expect(rep.counters.backfilled).toBe(1);
    expect(rep.counters.linked).toBe(1);
  });

  it('sub≠users.id без approved-mapping → mismatch + СТОП', async () => {
    const u = user();
    const kc = new MockKc({
      resolve: () => ({ id: 'other-sub', email: u.email, attributes: {} }),
    });
    const links = new MockLinks();
    const rep = await runImport({
      source: mockSource([u]),
      kc,
      links,
      provider: 'keycloak-local',
      groupActive: 'billhub-active',
      groupPending: 'billhub-pending',
      now: NOW,
    });
    expect(rep.stopped).toBe(true);
    expect(rep.mismatches).toEqual([{ userId: u.id, kcSub: 'other-sub', email: u.email }]);
    expect(links.bySubject.size).toBe(0);
  });

  it('sub≠users.id, но approved-mapping разрешает → линкуется по реальному sub', async () => {
    const u = user();
    const kc = new MockKc({
      resolve: () => ({ id: 'other-sub', email: u.email, attributes: { billhub_user_id: [u.id] } }),
    });
    const links = new MockLinks();
    const rep = await runImport({
      source: mockSource([u]),
      kc,
      links,
      provider: 'keycloak-local',
      groupActive: 'billhub-active',
      groupPending: 'billhub-pending',
      approvedMapping: { [u.id]: 'other-sub' },
      now: NOW,
    });
    expect(rep.stopped).toBe(false);
    expect(links.byUser.get(`keycloak-local:${u.id}`)).toBe('other-sub');
  });

  it('checkpoint resume: уже обработанные (id ≤ cursor) пропускаются', async () => {
    const u1 = user({ id: 'aaa', email: 'a1@x.com' });
    const u2 = user({ id: 'bbb', email: 'b2@x.com' });
    const kc = new MockKc({
      resolve: (email) => (email === 'b2@x.com' ? resolvedSelf(u2) : resolvedSelf(u1)),
    });
    const links = new MockLinks();
    const cp = new MockCheckpoint({
      version: 1,
      cursor: 'aaa',
      counters: { ...emptyCounters(), processed: 1, linked: 1 },
      mismatches: [],
    });
    const rep = await runImport({
      source: mockSource([u1, u2]),
      kc,
      links,
      provider: 'keycloak-local',
      groupActive: 'billhub-active',
      groupPending: 'billhub-pending',
      checkpoint: cp,
      now: NOW,
    });
    // Обработан только u2; u1 (id ≤ cursor) пропущен.
    expect(kc.setActiveCalls.map((c) => c.userId)).toEqual(['bbb']);
    expect(rep.counters.linked).toBe(2); // 1 из prev + 1 новый
    expect(cp.state?.cursor).toBe('bbb');
  });

  it('отчёт не содержит bcrypt-хэш (redaction: секреты не утекают в вывод)', async () => {
    const u = user();
    const kc = new MockKc({ resolve: () => resolvedSelf(u) });
    const rep = await runImport({
      source: mockSource([u]),
      kc,
      links: new MockLinks(),
      provider: 'keycloak-local',
      groupActive: 'billhub-active',
      groupPending: 'billhub-pending',
      now: NOW,
    });
    expect(JSON.stringify(rep)).not.toContain(HASH);
  });
});

/* --------------------------------- runVerify ------------------------------- */

describe('runVerify', () => {
  it('нет линка → drift no_link', async () => {
    const u = user();
    const rep = await runVerify({
      source: mockSource([u]),
      kc: new MockKc(),
      links: new MockLinks(),
      provider: 'keycloak-local',
      groupActive: 'billhub-active',
      groupPending: 'billhub-pending',
    });
    expect(rep.drift).toEqual([{ userId: u.id, email: u.email, kind: 'no_link' }]);
  });

  it('линк есть, KC-юзер с атрибутом и группой → без дрейфа', async () => {
    const u = user();
    const links = new MockLinks();
    await links.link({
      userId: u.id,
      provider: 'keycloak-local',
      subject: u.id,
      emailAtLink: u.email,
    });
    const kc = new MockKc();
    kc.usersById.set(u.id, { id: u.id, attributes: { billhub_user_id: [u.id] } });
    kc.groupsById.set(u.id, [{ id: 'g', name: 'billhub-active', path: '/billhub-active' }]);
    const rep = await runVerify({
      source: mockSource([u]),
      kc,
      links,
      provider: 'keycloak-local',
      groupActive: 'billhub-active',
      groupPending: 'billhub-pending',
    });
    expect(rep.drift).toHaveLength(0);
    expect(rep.linked).toBe(1);
  });
});

/* -------------------------------- runReconcile ----------------------------- */

describe('runReconcile', () => {
  it('KC→БД: is_active приводится к членству в billhub-active', async () => {
    const u = user({ isActive: false }); // БД говорит inactive, а в KC — active
    const links = new MockLinks();
    await links.link({
      userId: u.id,
      provider: 'keycloak-local',
      subject: u.id,
      emailAtLink: u.email,
    });
    const kc = new MockKc();
    kc.groupsById.set(u.id, [{ id: 'g', name: 'billhub-active', path: '/billhub-active' }]);
    const mirror = new MockMirror();
    const rep = await runReconcile({
      source: mockSource([u]),
      kc,
      links,
      mirror,
      provider: 'keycloak-local',
      groupActive: 'billhub-active',
    });
    expect(mirror.calls).toEqual([{ userId: u.id, active: true }]);
    expect(rep.updated).toBe(1);
  });

  it('dry-run: зеркало не пишется', async () => {
    const u = user({ isActive: false });
    const links = new MockLinks();
    await links.link({
      userId: u.id,
      provider: 'keycloak-local',
      subject: u.id,
      emailAtLink: u.email,
    });
    const kc = new MockKc();
    kc.groupsById.set(u.id, [{ id: 'g', name: 'billhub-active', path: '/billhub-active' }]);
    const mirror = new MockMirror();
    const rep = await runReconcile({
      source: mockSource([u]),
      kc,
      links,
      mirror,
      provider: 'keycloak-local',
      groupActive: 'billhub-active',
      dryRun: true,
    });
    expect(mirror.calls).toHaveLength(0);
    expect(rep.updated).toBe(1);
  });
});

/* ---------------------------- runPreflight --check-kc ---------------------- */

describe('runPreflight --check-kc', () => {
  it('email уже в KC без нашего billhub_user_id (AD-коллизия) → blocker kc_email_exists', async () => {
    const u = user({ email: 'ad@x.com' });
    const kc = new MockKc({ resolve: () => ({ id: 'ad-sub', email: 'ad@x.com', attributes: {} }) });
    const { report, blocked } = await runPreflight({
      source: mockSource([u]),
      allowAnomalies: 0,
      kc,
    });
    expect(
      report.anomalies.some((a) => a.kind === 'kc_email_exists' && a.level === 'blocker'),
    ).toBe(true);
    expect(blocked).toBe(true);
  });

  it('email в KC уже с нашим billhub_user_id → не блокер', async () => {
    const u = user({ email: 'me@x.com' });
    const kc = new MockKc({
      resolve: () => ({ id: 'sub', email: 'me@x.com', attributes: { billhub_user_id: [u.id] } }),
    });
    const { report } = await runPreflight({ source: mockSource([u]), allowAnomalies: 0, kc });
    expect(report.anomalies.some((a) => a.kind === 'kc_email_exists')).toBe(false);
  });
});

/* -------------------------------- runImport --limit ------------------------ */

describe('runImport --limit', () => {
  it('обрабатывает не более N за прогон (resume продолжит остальное)', async () => {
    const u1 = user({ id: 'aaa', email: 'a1@x.com' });
    const u2 = user({ id: 'bbb', email: 'b1@x.com' });
    const kc = new MockKc({
      resolve: (email) => (email === 'a1@x.com' ? resolvedSelf(u1) : resolvedSelf(u2)),
    });
    const rep = await runImport({
      source: mockSource([u1, u2]),
      kc,
      links: new MockLinks(),
      provider: 'keycloak-local',
      groupActive: 'billhub-active',
      groupPending: 'billhub-pending',
      limit: 1,
      now: NOW,
    });
    expect(rep.counters.processed).toBe(1);
    expect(rep.cursor).toBe('aaa');
  });
});
