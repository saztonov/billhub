/**
 * Repository-интерфейс домена «outbox» (transactional outbox, стандарт v3 раздел 16).
 *
 * Контракт DB-агностичен. Транзакционная запись (outbox в той же транзакции, что и бизнес-
 * операция) — Drizzle-специфика: метод enqueueTx(tx, ...) объявлен только на Drizzle-реализации,
 * т.к. у Supabase-PostgREST нет дескриптора транзакции. Supabase-impl кидает not-supported
 * (принцип 2: Outbox is Drizzle-only).
 */
import type { OutboxEventInput, OutboxRow } from '../schemas/observability.js';

export interface OutboxRepository {
  /** Записать событие отдельной операцией (собственное соединение). Возвращает id. */
  enqueue(event: OutboxEventInput): Promise<string>;
  /** Непрочитанные события (processed_at IS NULL), порядок создания, LIMIT. Для диспетчера. */
  listUnprocessed(limit: number): Promise<OutboxRow[]>;
  /** Пометить обработанными (processed_at). Возвращает число строк. */
  markProcessed(ids: string[], processedAtIso: string): Promise<number>;
  /** Retention: удалить обработанные старше cutoff (ISO). Возвращает число строк. */
  deleteProcessedOlderThan(cutoffIso: string): Promise<number>;
}
