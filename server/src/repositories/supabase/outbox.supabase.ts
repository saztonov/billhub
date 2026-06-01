/**
 * Supabase-заглушка OutboxRepository. Outbox требует транзакционной семантики PostgreSQL
 * (запись события в одной транзакции с бизнес-операцией) — PostgREST это не предоставляет.
 * Принцип 2: контракт есть, реализация Supabase явно не поддержана (throw-not-supported).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutboxRepository } from '../outbox.repository.js';
import type { OutboxEventInput, OutboxRow } from '../../schemas/observability.js';

const NOT_SUPPORTED = 'Outbox is Drizzle-only';

export class SupabaseOutboxRepository implements OutboxRepository {
  constructor(_supabase: SupabaseClient) {}

  enqueue(_event: OutboxEventInput): Promise<string> {
    throw new Error(NOT_SUPPORTED);
  }
  listUnprocessed(_limit: number): Promise<OutboxRow[]> {
    throw new Error(NOT_SUPPORTED);
  }
  markProcessed(_ids: string[], _processedAtIso: string): Promise<number> {
    throw new Error(NOT_SUPPORTED);
  }
  deleteProcessedOlderThan(_cutoffIso: string): Promise<number> {
    throw new Error(NOT_SUPPORTED);
  }
}
