/**
 * RefreshTokenService — race-safe refresh rotation + reuse detection (стандарт v3 раздел 13).
 *
 * Алгоритм обмена (rotate):
 *   1. Быстрый путь grace-window: если этот же token недавно (≤ graceMs) уже обменян —
 *      возвращаем ТОТ ЖЕ новый токен (для параллельных вкладок), без новой ротации.
 *   2. Иначе — блокируем строку по token_hash (SELECT FOR UPDATE на PG / keyed-mutex в памяти)
 *      и в транзакции:
 *        - строки нет → invalid;
 *        - строка revoked → внутри окна повторно проверяем grace (могла быть заполнена
 *          параллельной ротацией); иначе REUSE: ревокация всей family + audit «refresh_reuse»;
 *        - строка истекла → invalid;
 *        - иначе ротация: insert нового токена (та же family) + mark old replaced/revoked,
 *          запись в grace-cache.
 *
 * grace-cache — in-memory (Этап 1 = 1 backend). На Этап 2 (2 VM) потребуется общий Redis —
 * зафиксировано в плане как риск масштабирования.
 */
import { randomUUID } from 'node:crypto';
import { TokenService } from './token.service.js';
import type { AuditLogger } from './audit.js';
import type { RefreshTokenStore } from './stores/types.js';

export interface RotationContext {
  ip?: string | null;
  userAgent?: string | null;
}

/** Успешная выдача refresh-токена (login или rotate). */
export interface IssuedRefresh {
  userId: string;
  refreshToken: string;
  refreshExpiresAtMs: number;
  familyId: string;
}

export type RotateResult =
  | (IssuedRefresh & { ok: true; rotated: boolean })
  | { ok: false; reason: 'invalid' | 'reuse_detected' };

interface GraceEntry extends IssuedRefresh {
  expiresAtMs: number;
}

export interface RefreshTokenServiceOptions {
  store: RefreshTokenStore;
  tokens: TokenService;
  refreshTtlSeconds: number;
  graceMs: number;
  now?: () => number;
  audit?: AuditLogger;
}

export class RefreshTokenService {
  private readonly store: RefreshTokenStore;
  private readonly tokens: TokenService;
  private readonly refreshTtlSeconds: number;
  private readonly graceMs: number;
  private readonly now: () => number;
  private readonly audit?: AuditLogger;
  private readonly grace = new Map<string, GraceEntry>();

  constructor(opts: RefreshTokenServiceOptions) {
    this.store = opts.store;
    this.tokens = opts.tokens;
    this.refreshTtlSeconds = opts.refreshTtlSeconds;
    this.graceMs = opts.graceMs;
    this.now = opts.now ?? Date.now;
    this.audit = opts.audit;
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  private graceGet(tokenHash: string): IssuedRefresh | null {
    const e = this.grace.get(tokenHash);
    if (!e) return null;
    if (e.expiresAtMs <= this.now()) {
      this.grace.delete(tokenHash);
      return null;
    }
    return {
      userId: e.userId,
      refreshToken: e.refreshToken,
      refreshExpiresAtMs: e.refreshExpiresAtMs,
      familyId: e.familyId,
    };
  }

  private graceSet(tokenHash: string, issued: IssuedRefresh): void {
    this.grace.set(tokenHash, { ...issued, expiresAtMs: this.now() + this.graceMs });
  }

  /** Выдаёт первый refresh-токен новой family (вызывается при login). */
  async issueForLogin(userId: string, ctx: RotationContext = {}): Promise<IssuedRefresh> {
    const familyId = randomUUID();
    const pair = this.tokens.generateRefreshToken();
    const nowMs = this.now();
    const expiresAtMs = nowMs + this.refreshTtlSeconds * 1000;
    await this.store.create({
      userId,
      tokenHash: pair.hash,
      familyId,
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    return { userId, refreshToken: pair.plain, refreshExpiresAtMs: expiresAtMs, familyId };
  }

  /** Обмен refresh-токена (race-safe rotation). */
  async rotate(presentedPlain: string, ctx: RotationContext = {}): Promise<RotateResult> {
    if (!TokenService.isValidRefreshFormat(presentedPlain)) {
      return { ok: false, reason: 'invalid' };
    }
    const hash = TokenService.hashRefreshToken(presentedPlain);

    const fast = this.graceGet(hash);
    if (fast) return { ok: true, rotated: false, ...fast };

    return this.store.withLockedToken(hash, async (tx) => {
      // Повторная проверка grace внутри блокировки: параллельная ротация могла её заполнить.
      const within = this.graceGet(hash);
      if (within) return { ok: true, rotated: false, ...within };

      const row = tx.row;
      if (!row) return { ok: false, reason: 'invalid' };

      const nowMs = this.now();

      if (row.revokedAt !== null) {
        // Повтор уже отозванного токена за пределами grace-window → reuse detection.
        await tx.revokeFamily(row.familyId, this.nowIso());
        this.audit?.emit('refresh_reuse', {
          userId: row.userId,
          familyId: row.familyId,
          ip: ctx.ip ?? undefined,
          reason: 'replayed_revoked_refresh_token',
        });
        return { ok: false, reason: 'reuse_detected' };
      }

      if (Date.parse(row.expiresAt) <= nowMs) {
        return { ok: false, reason: 'invalid' };
      }

      // Ротация: новый токен той же family + пометка старого заменённым.
      const pair = this.tokens.generateRefreshToken();
      const expiresAtMs = nowMs + this.refreshTtlSeconds * 1000;
      const issuedAtIso = new Date(nowMs).toISOString();
      const newId = await tx.insert({
        userId: row.userId,
        tokenHash: pair.hash,
        familyId: row.familyId,
        issuedAt: issuedAtIso,
        expiresAt: new Date(expiresAtMs).toISOString(),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      });
      await tx.markReplaced(row.id, newId, issuedAtIso);

      const issued: IssuedRefresh = {
        userId: row.userId,
        refreshToken: pair.plain,
        refreshExpiresAtMs: expiresAtMs,
        familyId: row.familyId,
      };
      this.graceSet(hash, issued);
      this.audit?.emit('token_refresh', {
        userId: row.userId,
        familyId: row.familyId,
        ip: ctx.ip ?? undefined,
      });
      return { ok: true, rotated: true, ...issued };
    });
  }

  /** Ревокация family по предъявленному refresh-токену (logout). Возвращает число строк. */
  async revokeByToken(presentedPlain: string): Promise<number> {
    if (!TokenService.isValidRefreshFormat(presentedPlain)) return 0;
    const hash = TokenService.hashRefreshToken(presentedPlain);
    const familyId = await this.store.findFamilyByHash(hash);
    if (!familyId) return 0;
    return this.store.revokeFamily(familyId, this.nowIso());
  }
}
