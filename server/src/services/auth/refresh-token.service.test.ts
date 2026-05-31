/**
 * Unit-тесты RefreshTokenService: ротация, grace-window (параллельные вкладки),
 * reuse detection (инвалидация family + audit). In-memory store с keyed-mutex воспроизводит
 * семантику SELECT FOR UPDATE без Docker.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TokenService } from './token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { InMemoryRefreshTokenStore } from './stores/memory.js';
import { RecordingAuditLogger } from './audit.js';

const T0 = 1_750_000_000_000;
const TTL = 3600;
const GRACE_MS = 5000;

function setup() {
  let now = T0;
  const clock = () => now;
  const advance = (ms: number) => {
    now += ms;
  };
  const store = new InMemoryRefreshTokenStore();
  const tokens = new TokenService({
    secret: 'refresh-test-secret-long-enough-0123456789',
    issuer: 'BillHub',
    audience: 'billhub',
    accessTtlSeconds: 900,
    now: clock,
  });
  const audit = new RecordingAuditLogger();
  const svc = new RefreshTokenService({
    store,
    tokens,
    refreshTtlSeconds: TTL,
    graceMs: GRACE_MS,
    now: clock,
    audit,
  });
  return { svc, store, audit, advance, clock, tokens };
}

describe('RefreshTokenService — базовая ротация', () => {
  it('issueForLogin создаёт первый токен новой family', async () => {
    const { svc, store } = setup();
    const issued = await svc.issueForLogin('user-1', { ip: '127.0.0.1' });
    expect(TokenService.isValidRefreshFormat(issued.refreshToken)).toBe(true);
    const rows = store.snapshot();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.familyId).toBe(issued.familyId);
    expect(rows[0]!.revokedAt).toBeNull();
  });

  it('rotate валидного токена: новый токен, старый revoked, rotated=true', async () => {
    const { svc, store } = setup();
    const issued = await svc.issueForLogin('user-1');
    const res = await svc.rotate(issued.refreshToken);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rotated).toBe(true);
    expect(res.refreshToken).not.toBe(issued.refreshToken);
    const rows = store.snapshot();
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1); // активен только новый
  });

  it('цепочка ротаций: новый токен можно обменять снова', async () => {
    const { svc } = setup();
    const issued = await svc.issueForLogin('user-1');
    const r1 = await svc.rotate(issued.refreshToken);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = await svc.rotate(r1.refreshToken);
    expect(r2.ok).toBe(true);
  });

  it('невалидный формат → invalid', async () => {
    const { svc } = setup();
    const res = await svc.rotate('not-a-valid-token');
    expect(res).toEqual({ ok: false, reason: 'invalid' });
  });

  it('неизвестный токен (валидный формат) → invalid', async () => {
    const { svc, tokens } = setup();
    const fake = tokens.generateRefreshToken().plain;
    const res = await svc.rotate(fake);
    expect(res).toEqual({ ok: false, reason: 'invalid' });
  });

  it('истёкший refresh-токен → invalid', async () => {
    const { svc, advance } = setup();
    const issued = await svc.issueForLogin('user-1');
    advance(TTL * 1000 + 1000); // за пределами срока действия и grace
    const res = await svc.rotate(issued.refreshToken);
    expect(res).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('RefreshTokenService — grace-window (параллельные вкладки)', () => {
  it('5 параллельных rotate одной family → все валидны, ровно одна реальная замена', async () => {
    const { svc, store } = setup();
    const issued = await svc.issueForLogin('user-1');

    const results = await Promise.all(
      Array.from({ length: 5 }, () => svc.rotate(issued.refreshToken)),
    );

    // Все успешны
    expect(results.every((r) => r.ok)).toBe(true);
    // Ровно одна реальная ротация
    const rotatedTrue = results.filter((r) => r.ok && r.rotated);
    expect(rotatedTrue).toHaveLength(1);
    // Все получили ОДИН И ТОТ ЖЕ новый токен (grace-window)
    const tokensReturned = new Set(results.map((r) => (r.ok ? r.refreshToken : 'x')));
    expect(tokensReturned.size).toBe(1);
    // В БД: исходный + ровно один новый
    const rows = store.snapshot();
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
  });

  it('повтор внутри grace-window → тот же новый токен, без новой строки', async () => {
    const { svc, store } = setup();
    const issued = await svc.issueForLogin('user-1');
    const r1 = await svc.rotate(issued.refreshToken);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = await svc.rotate(issued.refreshToken); // тот же старый токен, в пределах grace
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.rotated).toBe(false);
    expect(r2.refreshToken).toBe(r1.refreshToken);
    expect(store.snapshot()).toHaveLength(2); // новой строки не появилось
  });
});

describe('RefreshTokenService — reuse detection', () => {
  it('повтор старого токена за пределами grace → reuse: family инвалидирована + audit', async () => {
    const { svc, store, audit, advance } = setup();
    const issued = await svc.issueForLogin('user-1');
    const r1 = await svc.rotate(issued.refreshToken);
    expect(r1.ok).toBe(true);

    advance(GRACE_MS + 1000); // grace истёк

    const replay = await svc.rotate(issued.refreshToken);
    expect(replay).toEqual({ ok: false, reason: 'reuse_detected' });

    // Вся family ревокнута (включая валидный новый токен)
    const rows = store.snapshot();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);

    // Audit зафиксировал refresh_reuse
    const reuse = audit.events.find((e) => e.event === 'refresh_reuse');
    expect(reuse).toBeDefined();
    expect(reuse!.fields.userId).toBe('user-1');
    expect(reuse!.fields.familyId).toBe(issued.familyId);
  });

  it('после reuse даже валидный новый токен больше не обменивается', async () => {
    const { svc, advance } = setup();
    const issued = await svc.issueForLogin('user-1');
    const r1 = await svc.rotate(issued.refreshToken);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    advance(GRACE_MS + 1000);
    await svc.rotate(issued.refreshToken); // триггерит reuse → ревокация family

    const afterReuse = await svc.rotate(r1.refreshToken);
    expect(afterReuse.ok).toBe(false);
  });
});

describe('RefreshTokenService — logout', () => {
  it('revokeByToken ревокает всю family', async () => {
    const { svc, store } = setup();
    const issued = await svc.issueForLogin('user-1');
    const n = await svc.revokeByToken(issued.refreshToken);
    expect(n).toBe(1);
    expect(store.snapshot().every((r) => r.revokedAt !== null)).toBe(true);
    // обмен ревокнутого токена → reuse/invalid
    const res = await svc.rotate(issued.refreshToken);
    expect(res.ok).toBe(false);
  });

  it('revokeByToken неизвестного токена → 0', async () => {
    const { svc, tokens } = setup();
    const unknown = tokens.generateRefreshToken().plain;
    expect(await svc.revokeByToken(unknown)).toBe(0);
  });
});

describe('RefreshTokenService — grep: отсутствие секретов в audit', () => {
  let captured: string;
  beforeEach(async () => {
    const { svc, audit, advance } = setup();
    const issued = await svc.issueForLogin('user-1');
    await svc.rotate(issued.refreshToken);
    advance(GRACE_MS + 1000);
    await svc.rotate(issued.refreshToken);
    captured = audit.serialized();
  });

  it('audit не содержит plain refresh-токенов', () => {
    expect(captured).not.toMatch(/"token"/);
    expect(captured).not.toMatch(/refreshToken/);
    expect(captured).not.toMatch(/tokenHash/);
  });
});
