/**
 * Unit-тесты AuditLogService: маппинг полей в колонки/payload, HMAC email, отсутствие секретов,
 * pino-зеркало. Без БД (fake AuditLogRepository).
 */
import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { AuditLogService } from './audit-log.service.js';
import type { AuditLogRepository } from '../../repositories/audit-log.repository.js';
import type { AuditLogEntryInput } from '../../schemas/observability.js';

class FakeAuditRepo implements AuditLogRepository {
  entries: AuditLogEntryInput[] = [];
  async append(entry: AuditLogEntryInput): Promise<void> {
    this.entries.push(entry);
  }
}

function makeSink() {
  return { info: vi.fn() };
}

describe('AuditLogService.emit (совместимость с AuditLogger Iteration 6)', () => {
  it('маппит userId/emailHmac в колонки, остальное в payload', async () => {
    const repo = new FakeAuditRepo();
    const sink = makeSink();
    const svc = new AuditLogService({ repo, sink });
    svc.emit('login_success', {
      userId: 'u1',
      emailHmac: 'hmac-1',
      ip: '10.0.0.1',
      reason: 'ok',
    });
    // append синхронно пушит до возврата промиса
    expect(repo.entries).toHaveLength(1);
    const e = repo.entries[0]!;
    expect(e.eventType).toBe('login_success');
    expect(e.actorUserId).toBe('u1');
    expect(e.actorEmailHmac).toBe('hmac-1');
    expect(e.payload).toMatchObject({ ip: '10.0.0.1', reason: 'ok' });
    // userId/emailHmac не дублируются в payload
    expect(e.payload).not.toHaveProperty('userId');
    expect(e.payload).not.toHaveProperty('emailHmac');
    // pino-зеркало вызвано
    expect(sink.info).toHaveBeenCalledOnce();
  });

  it('НЕ пишет секреты в payload (sanitizeAuditFields)', async () => {
    const repo = new FakeAuditRepo();
    const svc = new AuditLogService({ repo, sink: makeSink() });
    svc.emit('password_reset_request', {
      userId: 'u2',
      tokenId: 'tok-id',
      // запрещённые ключи — должны быть вырезаны:
      password: 'PLAINTEXT',
      token: 'PLAINTOKEN',
      token_hash: 'HASH',
    } as never);
    const e = repo.entries[0]!;
    const serialized = JSON.stringify(e);
    expect(serialized).not.toContain('PLAINTEXT');
    expect(serialized).not.toContain('PLAINTOKEN');
    expect(serialized).not.toContain('HASH');
    expect(e.payload).toMatchObject({ tokenId: 'tok-id' });
  });
});

describe('AuditLogService.logEvent (awaitable)', () => {
  it('вычисляет actor_email_hmac из сырого email по HMAC-ключу', async () => {
    const repo = new FakeAuditRepo();
    const key = 'audit-key';
    const svc = new AuditLogService({ repo, hmacKey: key });
    await svc.logEvent({
      eventType: 'retention.cleanup',
      email: 'User@Example.com',
      payload: { outboxDeleted: 3 },
    });
    const expected = createHmac('sha256', key).update('user@example.com').digest('hex');
    const e = repo.entries[0]!;
    expect(e.actorEmailHmac).toBe(expected);
    expect(e.eventType).toBe('retention.cleanup');
    expect(e.payload).toMatchObject({ outboxDeleted: 3 });
  });

  it('emailHmac имеет приоритет над сырым email', async () => {
    const repo = new FakeAuditRepo();
    const svc = new AuditLogService({ repo, hmacKey: 'k' });
    await svc.logEvent({ eventType: 'x', emailHmac: 'preset', email: 'a@b.c' });
    expect(repo.entries[0]!.actorEmailHmac).toBe('preset');
  });
});
