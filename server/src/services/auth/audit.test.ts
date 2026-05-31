/**
 * Unit-тесты audit: фильтрация секретов (sanitizeAuditFields) и pino-sink.
 */
import { describe, it, expect, vi } from 'vitest';
import { sanitizeAuditFields, createPinoAuditLogger, RecordingAuditLogger } from './audit.js';

describe('sanitizeAuditFields', () => {
  it('удаляет секретные ключи, сохраняет безопасные', () => {
    const out = sanitizeAuditFields({
      userId: 'u1',
      tokenId: 't1',
      familyId: 'f1',
      emailHmac: 'h1',
      // секреты — должны быть вырезаны
      password: 'p',
      token: 'plain-refresh',
      refreshToken: 'r',
      tokenHash: 'hh',
      secret: 's',
    });
    expect(out).toEqual({ userId: 'u1', tokenId: 't1', familyId: 'f1', emailHmac: 'h1' });
  });

  it('пропускает undefined-поля', () => {
    expect(sanitizeAuditFields({ userId: undefined, reason: 'x' })).toEqual({ reason: 'x' });
  });

  it('undefined fields → пустой объект', () => {
    expect(sanitizeAuditFields(undefined)).toEqual({});
  });
});

describe('createPinoAuditLogger', () => {
  it('эмитит структурное событие { audit:true, event, ...fields }', () => {
    const info = vi.fn();
    const logger = createPinoAuditLogger({ info });
    logger.emit('login_success', { userId: 'u1', token: 'should-be-stripped' });
    expect(info).toHaveBeenCalledTimes(1);
    const [obj, msg] = info.mock.calls[0]!;
    expect(obj).toMatchObject({ audit: true, event: 'login_success', userId: 'u1' });
    expect(obj).not.toHaveProperty('token');
    expect(msg).toBe('audit:login_success');
  });
});

describe('RecordingAuditLogger', () => {
  it('сохраняет санитизированные события и сериализует их', () => {
    const rec = new RecordingAuditLogger();
    rec.emit('refresh_reuse', { userId: 'u1', familyId: 'f1', token: 'secret' });
    expect(rec.events).toHaveLength(1);
    expect(rec.events[0]!.fields).toEqual({ userId: 'u1', familyId: 'f1' });
    expect(rec.serialized()).not.toContain('secret');
  });
});
