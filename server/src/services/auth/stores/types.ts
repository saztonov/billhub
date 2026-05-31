/**
 * Порты хранилищ для standalone-auth (Strangler Fig: in-memory для unit-тестов,
 * postgres.js/Drizzle для production). Бизнес-логика сервисов не зависит от реализации.
 *
 * Race-safety refresh rotation обеспечивается контрактом withLockedToken: реализация
 * на PG использует SELECT ... FOR UPDATE внутри транзакции; in-memory — keyed-mutex.
 */

/** Профиль пользователя для аутентификации (включая секретный password_hash). */
export interface UserAuthRecord {
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
}

export interface UserAuthStore {
  findByEmail(email: string): Promise<UserAuthRecord | null>;
  findById(id: string): Promise<UserAuthRecord | null>;
  setPasswordHash(userId: string, hash: string, changedAtIso: string): Promise<void>;
}

/** Строка refresh_tokens (без секретного ip/user_agent — они не нужны логике). */
export interface RefreshTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  issuedAt: string;
  expiresAt: string;
  replacedBy: string | null;
  revokedAt: string | null;
}

/** Данные создания refresh-токена. */
export interface NewRefreshToken {
  userId: string;
  tokenHash: string;
  familyId: string;
  issuedAt: string;
  expiresAt: string;
  ip?: string | null;
  userAgent?: string | null;
}

/** Операции, доступные внутри заблокированной транзакции обмена refresh-токена. */
export interface RefreshTxContext {
  /** Текущая (заблокированная) строка по запрошенному tokenHash, либо null. */
  readonly row: RefreshTokenRow | null;
  /** Вставить новый токен (ротация). Возвращает id. */
  insert(token: NewRefreshToken): Promise<string>;
  /** Пометить строку заменённой (replaced_by + revoked_at). */
  markReplaced(id: string, replacedById: string, revokedAtIso: string): Promise<void>;
  /** Ревокнуть всю family (reuse detection). Возвращает число строк. */
  revokeFamily(familyId: string, atIso: string): Promise<number>;
}

export interface RefreshTokenStore {
  /**
   * Атомарно блокирует строку по tokenHash (SELECT FOR UPDATE на PG) и выполняет fn
   * в транзакции. Параллельные вызовы с тем же tokenHash сериализуются.
   */
  withLockedToken<T>(tokenHash: string, fn: (ctx: RefreshTxContext) => Promise<T>): Promise<T>;
  /** Создать новый токен вне обмена (login — новая family). Возвращает id. */
  create(token: NewRefreshToken): Promise<string>;
  /** Ревокнуть всю family (logout). Возвращает число ревокнутых строк. */
  revokeFamily(familyId: string, atIso: string): Promise<number>;
  /** family_id по tokenHash (для logout). */
  findFamilyByHash(tokenHash: string): Promise<string | null>;
}

/** Строка password_reset_tokens. */
export interface PasswordResetRow {
  id: string;
  userId: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface PasswordResetStore {
  /** Создать токен сброса. Возвращает id (token_id — единственное, что попадёт в audit_log). */
  create(userId: string, tokenHash: string, expiresAtIso: string): Promise<string>;
  findByHash(tokenHash: string): Promise<PasswordResetRow | null>;
  markUsed(id: string, usedAtIso: string): Promise<void>;
}

/** Полный набор хранилищ auth. */
export interface AuthStores {
  users: UserAuthStore;
  refreshTokens: RefreshTokenStore;
  passwordResets: PasswordResetStore;
}
