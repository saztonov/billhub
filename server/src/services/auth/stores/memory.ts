/**
 * In-memory реализации auth-хранилищ. Используются в unit-тестах (детерминированно,
 * без Docker) и как dev-fallback. Production использует pg-реализации (stores/pg.ts).
 *
 * InMemoryRefreshTokenStore.withLockedToken сериализует параллельные вызовы по token_hash
 * через keyed-mutex — это воспроизводит семантику SELECT ... FOR UPDATE для тестов
 * race-safety, не требуя реального PostgreSQL.
 */
import { randomUUID } from 'node:crypto';
import type {
  IdentityLinkRecord,
  IdentityLinkStore,
  NewRefreshToken,
  PasswordResetRow,
  PasswordResetStore,
  RefreshTokenRow,
  RefreshTokenStore,
  RefreshTxContext,
  UserAuthRecord,
  UserAuthStore,
} from './types.js';

/** Полная строка refresh-токена в памяти. */
interface MemRefreshRow extends RefreshTokenRow {
  ip: string | null;
  userAgent: string | null;
}

export class InMemoryUserAuthStore implements UserAuthStore {
  private readonly byId = new Map<string, UserAuthRecord>();

  constructor(initial: UserAuthRecord[] = []) {
    for (const u of initial) this.byId.set(u.id, { ...u });
  }

  /** Добавить/заменить пользователя (для тестов и наполнения). */
  upsert(u: UserAuthRecord): void {
    this.byId.set(u.id, { ...u });
  }

  async findByEmail(email: string): Promise<UserAuthRecord | null> {
    const norm = email.trim().toLowerCase();
    for (const u of this.byId.values()) {
      if (u.email.trim().toLowerCase() === norm) return { ...u };
    }
    return null;
  }

  async findById(id: string): Promise<UserAuthRecord | null> {
    const u = this.byId.get(id);
    return u ? { ...u } : null;
  }

  async setPasswordHash(userId: string, hash: string, changedAtIso: string): Promise<void> {
    const u = this.byId.get(userId);
    if (!u) return;
    u.passwordHash = hash;
    u.passwordChangedAt = changedAtIso;
  }
}

export class InMemoryRefreshTokenStore implements RefreshTokenStore {
  private readonly rows: MemRefreshRow[] = [];
  private readonly chain = new Map<string, Promise<void>>();

  /** Снимок строк (для тест-ассертов о ревокации family). */
  snapshot(): MemRefreshRow[] {
    return this.rows.map((r) => ({ ...r }));
  }

  private insertRow(token: NewRefreshToken): string {
    const id = randomUUID();
    this.rows.push({
      id,
      userId: token.userId,
      tokenHash: token.tokenHash,
      familyId: token.familyId,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
      replacedBy: null,
      revokedAt: null,
      ip: token.ip ?? null,
      userAgent: token.userAgent ?? null,
    });
    return id;
  }

  private revokeFamilySync(familyId: string, atIso: string): number {
    let n = 0;
    for (const r of this.rows) {
      if (r.familyId === familyId && r.revokedAt === null) {
        r.revokedAt = atIso;
        n += 1;
      }
    }
    return n;
  }

  async create(token: NewRefreshToken): Promise<string> {
    return this.insertRow(token);
  }

  async revokeFamily(familyId: string, atIso: string): Promise<number> {
    return this.revokeFamilySync(familyId, atIso);
  }

  async findFamilyByHash(tokenHash: string): Promise<string | null> {
    const r = this.rows.find((x) => x.tokenHash === tokenHash);
    return r ? r.familyId : null;
  }

  async withLockedToken<T>(
    tokenHash: string,
    fn: (ctx: RefreshTxContext) => Promise<T>,
  ): Promise<T> {
    const prev = this.chain.get(tokenHash) ?? Promise.resolve();
    let release: () => void = () => {};
    const mine = new Promise<void>((res) => {
      release = res;
    });
    this.chain.set(
      tokenHash,
      prev.then(() => mine),
    );
    await prev;
    try {
      const found = this.rows.find((r) => r.tokenHash === tokenHash) ?? null;
      const ctx: RefreshTxContext = {
        row: found
          ? {
              id: found.id,
              userId: found.userId,
              tokenHash: found.tokenHash,
              familyId: found.familyId,
              issuedAt: found.issuedAt,
              expiresAt: found.expiresAt,
              replacedBy: found.replacedBy,
              revokedAt: found.revokedAt,
            }
          : null,
        insert: async (t) => this.insertRow(t),
        markReplaced: async (id, replacedById, revokedAtIso) => {
          const r = this.rows.find((x) => x.id === id);
          if (r) {
            r.replacedBy = replacedById;
            r.revokedAt = revokedAtIso;
          }
        },
        revokeFamily: async (familyId, atIso) => this.revokeFamilySync(familyId, atIso),
      };
      return await fn(ctx);
    } finally {
      release();
    }
  }
}

export class InMemoryPasswordResetStore implements PasswordResetStore {
  private readonly rows = new Map<
    string,
    { id: string; userId: string; tokenHash: string; expiresAt: string; usedAt: string | null }
  >();

  async create(userId: string, tokenHash: string, expiresAtIso: string): Promise<string> {
    const id = randomUUID();
    this.rows.set(id, { id, userId, tokenHash, expiresAt: expiresAtIso, usedAt: null });
    return id;
  }

  async findByHash(tokenHash: string): Promise<PasswordResetRow | null> {
    for (const r of this.rows.values()) {
      if (r.tokenHash === tokenHash) {
        return { id: r.id, userId: r.userId, expiresAt: r.expiresAt, usedAt: r.usedAt };
      }
    }
    return null;
  }

  async markUsed(id: string, usedAtIso: string): Promise<void> {
    const r = this.rows.get(id);
    if (r) r.usedAt = usedAtIso;
  }
}

export class InMemoryIdentityLinkStore implements IdentityLinkStore {
  private readonly rows: IdentityLinkRecord[] = [];

  constructor(initial: IdentityLinkRecord[] = []) {
    for (const r of initial) this.rows.push({ ...r });
  }

  async findBySubject(provider: string, subject: string): Promise<IdentityLinkRecord | null> {
    const r = this.rows.find((x) => x.provider === provider && x.subject === subject);
    return r ? { ...r } : null;
  }

  async findSubjectByUserId(provider: string, userId: string): Promise<string | null> {
    const r = this.rows.find((x) => x.provider === provider && x.userId === userId);
    return r ? r.subject : null;
  }

  async link(input: {
    userId: string;
    provider: string;
    subject: string;
    emailAtLink: string | null;
  }): Promise<string> {
    const existing = this.rows.find(
      (x) => x.provider === input.provider && x.subject === input.subject,
    );
    if (existing) return existing.id;
    const id = randomUUID();
    this.rows.push({
      id,
      userId: input.userId,
      provider: input.provider,
      subject: input.subject,
      emailAtLink: input.emailAtLink,
      linkedAt: new Date().toISOString(),
      lastSeenAt: null,
    });
    return id;
  }

  async touchLastSeen(provider: string, subject: string, atIso: string): Promise<void> {
    const r = this.rows.find((x) => x.provider === provider && x.subject === subject);
    if (r) r.lastSeenAt = atIso;
  }
}
