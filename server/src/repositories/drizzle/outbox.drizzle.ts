/**
 * DrizzleOutboxRepository (Iteration 7). Transactional outbox (стандарт v3 раздел 16).
 *
 * enqueueTx(tx, event) — запись в outbox в ТОЙ ЖЕ транзакции, что и бизнес-операция:
 * откат транзакции откатывает и outbox-запись (атомарность публикации события).
 * Требует живой PostgreSQL — покрывается интеграционными тестами под testcontainers.
 */
import { and, asc, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { outbox } from '../../db/schema/index.js';
import type { OutboxRepository } from '../outbox.repository.js';
import type { OutboxEventInput, OutboxRow } from '../../schemas/observability.js';

type Db = PostgresJsDatabase<typeof schema>;
type AnyTx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Исполнитель запроса: основной пул или активная транзакция (для transactional outbox). */
export type OutboxExecutor = Db | AnyTx;

/** Вставка строки outbox произвольным исполнителем (пул или tx). Возвращает id. */
async function insertOutbox(executor: OutboxExecutor, event: OutboxEventInput): Promise<string> {
  const [ins] = await executor
    .insert(outbox)
    .values({
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.payload ?? {},
    })
    .returning({ id: outbox.id });
  return ins!.id;
}

export class DrizzleOutboxRepository implements OutboxRepository {
  constructor(private readonly db: Db) {}

  /**
   * Записать событие в outbox в переданной транзакции (transactional outbox).
   * Вызывается из db.transaction(...) бизнес-операции — единственный способ гарантировать
   * атомарность «бизнес-запись + событие».
   */
  async enqueueTx(tx: OutboxExecutor, event: OutboxEventInput): Promise<string> {
    return insertOutbox(tx, event);
  }

  async enqueue(event: OutboxEventInput): Promise<string> {
    return insertOutbox(this.db, event);
  }

  async listUnprocessed(limit: number): Promise<OutboxRow[]> {
    const rows = await this.db
      .select({
        id: outbox.id,
        aggregateType: outbox.aggregateType,
        aggregateId: outbox.aggregateId,
        eventType: outbox.eventType,
        payload: outbox.payload,
        createdAt: outbox.createdAt,
        processedAt: outbox.processedAt,
      })
      .from(outbox)
      .where(isNull(outbox.processedAt))
      .orderBy(asc(outbox.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      aggregateType: r.aggregateType,
      aggregateId: r.aggregateId,
      eventType: r.eventType,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt,
      processedAt: r.processedAt,
    }));
  }

  async markProcessed(ids: string[], processedAtIso: string): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await this.db
      .update(outbox)
      .set({ processedAt: processedAtIso })
      .where(inArray(outbox.id, ids))
      .returning({ id: outbox.id });
    return res.length;
  }

  async deleteProcessedOlderThan(cutoffIso: string): Promise<number> {
    const res = await this.db
      .delete(outbox)
      .where(and(isNotNull(outbox.processedAt), lt(outbox.processedAt, cutoffIso)))
      .returning({ id: outbox.id });
    return res.length;
  }
}
