/**
 * PostgreSQL/Drizzle-реализации auth-хранилищ (production-путь standalone auth).
 *
 * Race-safety обеспечивается DrizzleRefreshTokenStore.withLockedToken: внутри db.transaction
 * строка блокируется `SELECT ... FOR UPDATE` (.for('update')); параллельные обмены тем же
 * токеном сериализуются на уровне БД (грейс-window + reuse-detection в RefreshTokenService).
 *
 * Требует живой PostgreSQL — покрывается интеграционными тестами под testcontainers
 * (как и src/repositories/drizzle/**); из unit-coverage исключён.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../db/schema/index.js';
import { passwordResetTokens, refreshTokens, users } from '../../../db/schema/index.js';
import type {
  NewRefreshToken,
  PasswordResetRow,
  PasswordResetStore,
  RefreshTokenRow,
  RefreshTokenStore,
  RefreshTxContext,
  UserAuthRecord,
  UserAuthStore,
} from './types.js';

type Db = PostgresJsDatabase<typeof schema>;
type AnyTx = Parameters<Parameters<Db['transaction']>[0]>[0];

function mapUser(r: {
  id: string;
  email: string;
  role: string;
  counterpartyId: string | null;
  departmentId: string | null;
  allSites: boolean;
  fullName: string;
  isActive: boolean;
  passwordHash: string | null;
  passwordChangedAt: string | null;
}): UserAuthRecord {
  return { ...r };
}

export class DrizzleUserAuthStore implements UserAuthStore {
  constructor(private readonly db: Db) {}

  private cols() {
    return {
      id: users.id,
      email: users.email,
      role: users.role,
      counterpartyId: users.counterpartyId,
      departmentId: users.departmentId,
      allSites: users.allSites,
      fullName: users.fullName,
      isActive: users.isActive,
      passwordHash: users.passwordHash,
      passwordChangedAt: users.passwordChangedAt,
    };
  }

  // Регистронезависимо (совместимо с UNIQUE-индексом users_email_lower_unique_idx,
  // миграция 0005): без этого пользователи с не-lowercase email в БД не могут залогиниться,
  // если вводят email в другом регистре.
  async findByEmail(email: string): Promise<UserAuthRecord | null> {
    const [r] = await this.db
      .select(this.cols())
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    return r ? mapUser(r) : null;
  }

  async findById(id: string): Promise<UserAuthRecord | null> {
    const [r] = await this.db.select(this.cols()).from(users).where(eq(users.id, id)).limit(1);
    return r ? mapUser(r) : null;
  }

  async setPasswordHash(userId: string, hash: string, changedAtIso: string): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash: hash, passwordChangedAt: changedAtIso })
      .where(eq(users.id, userId));
  }
}

function rowCols() {
  return {
    id: refreshTokens.id,
    userId: refreshTokens.userId,
    tokenHash: refreshTokens.tokenHash,
    familyId: refreshTokens.familyId,
    issuedAt: refreshTokens.issuedAt,
    expiresAt: refreshTokens.expiresAt,
    replacedBy: refreshTokens.replacedBy,
    revokedAt: refreshTokens.revokedAt,
  };
}

async function insertToken(tx: Db | AnyTx, token: NewRefreshToken): Promise<string> {
  const [ins] = await tx
    .insert(refreshTokens)
    .values({
      userId: token.userId,
      tokenHash: token.tokenHash,
      familyId: token.familyId,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
      ip: token.ip ?? null,
      userAgent: token.userAgent ?? null,
    })
    .returning({ id: refreshTokens.id });
  return ins!.id;
}

async function revokeFamilyRows(tx: Db | AnyTx, familyId: string, atIso: string): Promise<number> {
  const res = await tx
    .update(refreshTokens)
    .set({ revokedAt: atIso })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  return res.length;
}

export class DrizzleRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly db: Db) {}

  async withLockedToken<T>(
    tokenHash: string,
    fn: (ctx: RefreshTxContext) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const [r] = await tx
        .select(rowCols())
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .for('update')
        .limit(1);
      const row: RefreshTokenRow | null = r ?? null;
      const ctx: RefreshTxContext = {
        row,
        insert: (t) => insertToken(tx, t),
        markReplaced: async (id, replacedById, revokedAtIso) => {
          await tx
            .update(refreshTokens)
            .set({ replacedBy: replacedById, revokedAt: revokedAtIso })
            .where(eq(refreshTokens.id, id));
        },
        revokeFamily: (familyId, atIso) => revokeFamilyRows(tx, familyId, atIso),
      };
      return fn(ctx);
    });
  }

  async create(token: NewRefreshToken): Promise<string> {
    return insertToken(this.db, token);
  }

  async revokeFamily(familyId: string, atIso: string): Promise<number> {
    return revokeFamilyRows(this.db, familyId, atIso);
  }

  async findFamilyByHash(tokenHash: string): Promise<string | null> {
    const [r] = await this.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return r ? r.familyId : null;
  }
}

export class DrizzlePasswordResetStore implements PasswordResetStore {
  constructor(private readonly db: Db) {}

  async create(userId: string, tokenHash: string, expiresAtIso: string): Promise<string> {
    const [ins] = await this.db
      .insert(passwordResetTokens)
      .values({ userId, tokenHash, expiresAt: expiresAtIso })
      .returning({ id: passwordResetTokens.id });
    return ins!.id;
  }

  async findByHash(tokenHash: string): Promise<PasswordResetRow | null> {
    const [r] = await this.db
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
        expiresAt: passwordResetTokens.expiresAt,
        usedAt: passwordResetTokens.usedAt,
      })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1);
    return r ?? null;
  }

  async markUsed(id: string, usedAtIso: string): Promise<void> {
    await this.db
      .update(passwordResetTokens)
      .set({ usedAt: usedAtIso })
      .where(eq(passwordResetTokens.id, id));
  }
}
