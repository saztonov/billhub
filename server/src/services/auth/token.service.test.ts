/**
 * Unit-тесты TokenService: access JWT (HS256, iss/aud/exp) + opaque refresh token.
 */
import { describe, it, expect } from 'vitest';
import { decodeJwt } from 'jose';
import { TokenService } from './token.service.js';

function make(now?: () => number): TokenService {
  return new TokenService({
    secret: 'test-secret-which-is-long-enough-0123456789',
    issuer: 'BillHub',
    audience: 'billhub',
    accessTtlSeconds: 900,
    now,
  });
}

describe('TokenService — access JWT', () => {
  it('signAccess + verifyAccess: возвращает sub/role/email', async () => {
    const svc = make();
    const { token } = await svc.signAccess({ sub: 'u1', role: 'admin', email: 'a@b.c' });
    const claims = await svc.verifyAccess(token);
    expect(claims.sub).toBe('u1');
    expect(claims.role).toBe('admin');
    expect(claims.email).toBe('a@b.c');
  });

  it('JWT содержит iss=BillHub и aud=billhub', async () => {
    const svc = make();
    const { token } = await svc.signAccess({ sub: 'u1', role: 'user' });
    const payload = decodeJwt(token);
    expect(payload.iss).toBe('BillHub');
    expect(payload.aud).toBe('billhub');
    expect(payload.sub).toBe('u1');
  });

  it('expiresAtMs = iat + 900s', async () => {
    const t0 = 1_750_000_000_000;
    const svc = make(() => t0);
    const { expiresAtMs } = await svc.signAccess({ sub: 'u1', role: 'user' });
    expect(expiresAtMs).toBe(Math.floor(t0 / 1000) * 1000 + 900_000);
  });

  it('verifyAccess отклоняет токен с чужим audience', async () => {
    const signer = make();
    const { token } = await signer.signAccess({ sub: 'u1', role: 'user' });
    const wrongAud = new TokenService({
      secret: 'test-secret-which-is-long-enough-0123456789',
      issuer: 'BillHub',
      audience: 'other-portal',
      accessTtlSeconds: 900,
    });
    await expect(wrongAud.verifyAccess(token)).rejects.toThrow();
  });

  it('verifyAccess отклоняет токен, подписанный другим секретом', async () => {
    const signer = make();
    const { token } = await signer.signAccess({ sub: 'u1', role: 'user' });
    const other = new TokenService({
      secret: 'a-totally-different-secret-key-9876543210',
      issuer: 'BillHub',
      audience: 'billhub',
      accessTtlSeconds: 900,
    });
    await expect(other.verifyAccess(token)).rejects.toThrow();
  });

  it('verifyAccess отклоняет истёкший токен (currentDate в будущем)', async () => {
    const t0 = 1_750_000_000_000;
    const svc = make(() => t0);
    const { token } = await svc.signAccess({ sub: 'u1', role: 'user' });
    const future = new Date(t0 + 901_000);
    await expect(svc.verifyAccess(token, future)).rejects.toThrow();
  });

  it('verifyAccess принимает токен внутри срока действия', async () => {
    const t0 = 1_750_000_000_000;
    const svc = make(() => t0);
    const { token } = await svc.signAccess({ sub: 'u1', role: 'user' });
    const claims = await svc.verifyAccess(token, new Date(t0 + 100_000));
    expect(claims.sub).toBe('u1');
  });
});

describe('TokenService — opaque refresh', () => {
  it('generateRefreshToken: формат base64url 43 символа + sha256 hash', () => {
    const svc = make();
    const pair = svc.generateRefreshToken();
    expect(TokenService.isValidRefreshFormat(pair.plain)).toBe(true);
    expect(pair.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(TokenService.hashRefreshToken(pair.plain)).toBe(pair.hash);
  });

  it('два refresh-токена различаются (энтропия)', () => {
    const svc = make();
    const a = svc.generateRefreshToken();
    const b = svc.generateRefreshToken();
    expect(a.plain).not.toBe(b.plain);
    expect(a.hash).not.toBe(b.hash);
  });

  it('isValidRefreshFormat отклоняет невалидный формат', () => {
    expect(TokenService.isValidRefreshFormat('short')).toBe(false);
    expect(TokenService.isValidRefreshFormat('a'.repeat(43) + '=')).toBe(false);
    expect(TokenService.isValidRefreshFormat('!'.repeat(43))).toBe(false);
  });

  it('hashRefreshToken детерминирован', () => {
    expect(TokenService.hashRefreshToken('abc')).toBe(TokenService.hashRefreshToken('abc'));
    expect(TokenService.hashRefreshToken('abc')).not.toBe(TokenService.hashRefreshToken('abd'));
  });
});
