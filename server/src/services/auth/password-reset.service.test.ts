/**
 * Unit-тесты PasswordResetService: request/confirm/expired/used + ЖЁСТКИЙ ПРИНЦИП —
 * plain-токен сброса НИКОГДА не попадает в audit_log (только token_id/user_id/expiry).
 */
import { describe, it, expect } from 'vitest';
import { PasswordResetService } from './password-reset.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import { RecordingAuditLogger } from './audit.js';
import { InMemoryPasswordResetStore, InMemoryUserAuthStore } from './stores/memory.js';
import { ValidationError } from '../../repositories/types.js';
import type { UserAuthRecord } from './stores/types.js';

const T0 = 1_750_000_000_000;
const RESET_TTL = 3600;

function user(): UserAuthRecord {
  return {
    id: 'user-1',
    email: 'admin@example.com',
    role: 'admin',
    counterpartyId: null,
    departmentId: null,
    allSites: true,
    fullName: 'Admin',
    isActive: true,
    passwordHash: null,
    passwordChangedAt: null,
  };
}

function setup() {
  let now = T0;
  const clock = () => now;
  const advance = (ms: number) => {
    now += ms;
  };
  const users = new InMemoryUserAuthStore([user()]);
  const store = new InMemoryPasswordResetStore();
  const passwords = new PasswordService(8);
  const tokens = new TokenService({
    secret: 'reset-secret-long-enough-0123456789ABCDEF',
    issuer: 'BillHub',
    audience: 'billhub',
    accessTtlSeconds: 900,
    now: clock,
  });
  const audit = new RecordingAuditLogger();
  const svc = new PasswordResetService({
    store,
    users,
    passwords,
    tokens,
    ttlSeconds: RESET_TTL,
    now: clock,
    audit,
  });
  return { svc, users, passwords, audit, advance };
}

describe('PasswordResetService', () => {
  it('request возвращает plain-токен + token_id; в audit только token_id', async () => {
    const { svc, audit } = setup();
    const res = await svc.request('user-1');
    expect(TokenService.isValidRefreshFormat(res.plainToken)).toBe(true);
    expect(res.tokenId).toBeTruthy();

    const ev = audit.events.find((e) => e.event === 'password_reset_request');
    expect(ev).toBeDefined();
    expect(ev!.fields.tokenId).toBe(res.tokenId);
    expect(ev!.fields.userId).toBe('user-1');
    // plain-токен НЕ в audit
    expect(audit.serialized()).not.toContain(res.plainToken);
  });

  it('confirm валидного токена обновляет password_hash и помечает used', async () => {
    const { svc, users, passwords } = setup();
    const { plainToken } = await svc.request('user-1');
    const res = await svc.confirm(plainToken, 'brand-new-password');
    expect(res).toEqual({ ok: true, userId: 'user-1' });

    const rec = await users.findById('user-1');
    expect(rec!.passwordHash).toBeTruthy();
    expect(await passwords.compare('brand-new-password', rec!.passwordHash)).toBe(true);
  });

  it('повторный confirm тем же токеном → used', async () => {
    const { svc } = setup();
    const { plainToken } = await svc.request('user-1');
    await svc.confirm(plainToken, 'brand-new-password');
    const second = await svc.confirm(plainToken, 'another-new-password');
    expect(second).toEqual({ ok: false, reason: 'used' });
  });

  it('confirm истёкшего токена → expired', async () => {
    const { svc, advance } = setup();
    const { plainToken } = await svc.request('user-1');
    advance(RESET_TTL * 1000 + 1000);
    const res = await svc.confirm(plainToken, 'brand-new-password');
    expect(res).toEqual({ ok: false, reason: 'expired' });
  });

  it('confirm несуществующего токена → invalid', async () => {
    const { svc } = setup();
    const fakeToken = new TokenService({
      secret: 'x'.repeat(40),
      issuer: 'BillHub',
      audience: 'billhub',
      accessTtlSeconds: 900,
    }).generateRefreshToken().plain;
    const res = await svc.confirm(fakeToken, 'brand-new-password');
    expect(res).toEqual({ ok: false, reason: 'invalid' });
  });

  it('confirm со слабым паролем → ValidationError', async () => {
    const { svc } = setup();
    const { plainToken } = await svc.request('user-1');
    await expect(svc.confirm(plainToken, '123')).rejects.toThrow(ValidationError);
  });

  it('grep: полный цикл request+confirm не оставляет plain-токен в audit', async () => {
    const { svc, audit } = setup();
    const { plainToken } = await svc.request('user-1');
    await svc.confirm(plainToken, 'brand-new-password');
    const dump = audit.serialized();
    expect(dump).not.toContain(plainToken);
    expect(dump).not.toMatch(/"token"\s*:/);
    expect(dump).toMatch(/password_reset_confirm/);
  });
});
