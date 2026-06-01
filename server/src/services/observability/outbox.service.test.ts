/**
 * Unit-тесты OutboxService (диспетчер) на in-memory fake-репозитории.
 * Транзакционный rollback (enqueueTx) проверяется в Docker-интеграции (observability.integration.test.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import { OutboxService } from './outbox.service.js';
import type { OutboxRepository } from '../../repositories/outbox.repository.js';
import type { OutboxEventInput, OutboxRow } from '../../schemas/observability.js';

class InMemoryOutbox implements OutboxRepository {
  rows: OutboxRow[] = [];
  private seq = 0;
  async enqueue(event: OutboxEventInput): Promise<string> {
    const id = `ob-${++this.seq}`;
    this.rows.push({
      id,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.payload ?? {},
      createdAt: new Date(this.seq * 1000).toISOString(),
      processedAt: null,
    });
    return id;
  }
  async listUnprocessed(limit: number): Promise<OutboxRow[]> {
    return this.rows.filter((r) => r.processedAt === null).slice(0, limit);
  }
  async markProcessed(ids: string[], processedAtIso: string): Promise<number> {
    let n = 0;
    for (const r of this.rows) {
      if (ids.includes(r.id) && r.processedAt === null) {
        r.processedAt = processedAtIso;
        n += 1;
      }
    }
    return n;
  }
  async deleteProcessedOlderThan(): Promise<number> {
    return 0;
  }
}

const event = (eventType: string): OutboxEventInput => ({
  aggregateType: 'payment_request',
  aggregateId: '00000000-0000-0000-0000-000000000001',
  eventType,
  payload: { foo: 'bar' },
});

describe('OutboxService.dispatch', () => {
  it('обрабатывает события и помечает processed_at', async () => {
    const repo = new InMemoryOutbox();
    await repo.enqueue(event('a'));
    await repo.enqueue(event('b'));
    const handled: string[] = [];
    const svc = new OutboxService({
      repo,
      handler: async (e) => {
        handled.push(e.eventType);
      },
      now: () => 5_000,
    });

    const res = await svc.dispatch();
    expect(res).toEqual({ dispatched: 2, failed: 0 });
    expect(handled).toEqual(['a', 'b']);
    expect(repo.rows.every((r) => r.processedAt !== null)).toBe(true);
    // повторный проход — нечего обрабатывать
    expect(await svc.dispatch()).toEqual({ dispatched: 0, failed: 0 });
  });

  it('сбой handler оставляет событие непрочитанным (будет повтор)', async () => {
    const repo = new InMemoryOutbox();
    await repo.enqueue(event('ok'));
    await repo.enqueue(event('bad'));
    const svc = new OutboxService({
      repo,
      handler: async (e) => {
        if (e.eventType === 'bad') throw new Error('handler boom');
      },
      logger: { error: vi.fn() },
    });

    const res = await svc.dispatch();
    expect(res).toEqual({ dispatched: 1, failed: 1 });
    const remaining = await repo.listUnprocessed(10);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.eventType).toBe('bad');
  });

  it('пустой outbox — no-op', async () => {
    const repo = new InMemoryOutbox();
    const svc = new OutboxService({ repo, handler: async () => {} });
    expect(await svc.dispatch()).toEqual({ dispatched: 0, failed: 0 });
  });
});
