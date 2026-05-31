/**
 * PasswordResetService — запрос и подтверждение сброса пароля (стандарт v3 раздел 13).
 *
 * ЖЁСТКИЙ ПРИНЦИП (план Iteration 6): plain-токен сброса НИКОГДА не пишется в audit_log.
 * В audit попадают только token_id, user_id, expiry, факт выдачи. plain-токен возвращается
 * вызывающему ОДИН раз (request) — фронт показывает админу copy-once; доставка по email —
 * через @su10/mail (заглушка пишет в отдельный JSON-лог, не в audit_log).
 */
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import type { AuditLogger } from './audit.js';
import type { PasswordResetStore, UserAuthStore } from './stores/types.js';

export interface ResetRequestResult {
  /** id строки password_reset_tokens — единственное, что уходит в audit_log. */
  tokenId: string;
  /** plain-токен — возвращается ОДИН раз, в audit_log НЕ пишется. */
  plainToken: string;
  expiresAtMs: number;
}

export type ResetConfirmResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' };

export interface PasswordResetServiceOptions {
  store: PasswordResetStore;
  users: UserAuthStore;
  passwords: PasswordService;
  tokens: TokenService;
  ttlSeconds: number;
  now?: () => number;
  audit?: AuditLogger;
}

export class PasswordResetService {
  private readonly now: () => number;

  constructor(private readonly opts: PasswordResetServiceOptions) {
    this.now = opts.now ?? Date.now;
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  /** Создаёт токен сброса. Возвращает plain-токен (один раз) + token_id. */
  async request(userId: string): Promise<ResetRequestResult> {
    const pair = this.opts.tokens.generateRefreshToken();
    const nowMs = this.now();
    const expiresAtMs = nowMs + this.opts.ttlSeconds * 1000;
    const expiresAtIso = new Date(expiresAtMs).toISOString();
    const tokenId = await this.opts.store.create(userId, pair.hash, expiresAtIso);

    // В audit — ТОЛЬКО token_id/user_id/expiry/факт выдачи. Никогда сам токен.
    this.opts.audit?.emit('password_reset_request', {
      userId,
      tokenId,
      expiresAt: expiresAtIso,
    });

    return { tokenId, plainToken: pair.plain, expiresAtMs };
  }

  /** Подтверждает сброс: проверяет токен, обновляет password_hash, помечает used_at. */
  async confirm(plainToken: string, newPassword: string): Promise<ResetConfirmResult> {
    PasswordService.assertStrong(newPassword);

    if (!TokenService.isValidRefreshFormat(plainToken)) {
      return { ok: false, reason: 'invalid' };
    }
    const hash = TokenService.hashRefreshToken(plainToken);
    const row = await this.opts.store.findByHash(hash);
    if (!row) return { ok: false, reason: 'invalid' };
    if (row.usedAt !== null) return { ok: false, reason: 'used' };
    if (Date.parse(row.expiresAt) <= this.now()) return { ok: false, reason: 'expired' };

    const newHash = await this.opts.passwords.hash(newPassword);
    await this.opts.users.setPasswordHash(row.userId, newHash, this.nowIso());
    await this.opts.store.markUsed(row.id, this.nowIso());

    this.opts.audit?.emit('password_reset_confirm', { userId: row.userId, tokenId: row.id });
    return { ok: true, userId: row.userId };
  }
}
