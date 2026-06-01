/**
 * OutboxService — диспетчер transactional outbox (стандарт v3 раздел 16, план Iteration 7).
 *
 * Producer-сторона (запись события в ТОЙ ЖЕ транзакции, что и бизнес-операция) —
 * DrizzleOutboxRepository.enqueueTx(tx, event), вызывается из db.transaction(...) бизнес-кода.
 *
 * Consumer-сторона (этот сервис) — отдельный таймер (BullMQ recurring, интервал 5с):
 * читает outbox WHERE processed_at IS NULL ORDER BY created_at LIMIT N, передаёт каждое событие
 * handler-у (по плану §7 — запись в audit_log; для внешних подписчиков handler заменяется),
 * успешно обработанные помечает processed_at. Сбой одного события не блокирует остальные —
 * оно останется непрочитанным и будет повторено на следующем тике.
 */
import type { OutboxRepository } from '../../repositories/outbox.repository.js';
import type { OutboxRow } from '../../schemas/observability.js';
import type { AuditLogService } from '../auth/audit-log.service.js';

export type OutboxHandler = (event: OutboxRow) => Promise<void>;

export interface OutboxDispatchResult {
  dispatched: number;
  failed: number;
}

export interface OutboxServiceOptions {
  repo: OutboxRepository;
  handler: OutboxHandler;
  batchSize?: number;
  now?: () => number;
  logger?: { error: (obj: unknown, msg?: string) => void };
}

export class OutboxService {
  private readonly repo: OutboxRepository;
  private readonly handler: OutboxHandler;
  private readonly batchSize: number;
  private readonly now: () => number;
  private readonly logger?: { error: (obj: unknown, msg?: string) => void };

  constructor(opts: OutboxServiceOptions) {
    this.repo = opts.repo;
    this.handler = opts.handler;
    this.batchSize = opts.batchSize ?? 100;
    this.now = opts.now ?? Date.now;
    this.logger = opts.logger;
  }

  /** Один проход диспетчера. Возвращает счётчики обработанных/упавших событий. */
  async dispatch(): Promise<OutboxDispatchResult> {
    const events = await this.repo.listUnprocessed(this.batchSize);
    if (events.length === 0) return { dispatched: 0, failed: 0 };

    const succeeded: string[] = [];
    let failed = 0;
    for (const event of events) {
      try {
        await this.handler(event);
        succeeded.push(event.id);
      } catch (err) {
        failed += 1;
        this.logger?.error({ err, outboxId: event.id }, 'Outbox: обработка события не удалась');
      }
    }

    if (succeeded.length > 0) {
      await this.repo.markProcessed(succeeded, new Date(this.now()).toISOString());
    }
    return { dispatched: succeeded.length, failed };
  }
}

/**
 * Handler по умолчанию (план §7): публикует событие в audit_log как «outbox.<eventType>».
 * При появлении внешних подписчиков заменяется на реальную доставку.
 */
export function auditLogOutboxHandler(audit: AuditLogService): OutboxHandler {
  return async (event) => {
    await audit.logEvent({
      eventType: `outbox.${event.eventType}`,
      targetType: event.aggregateType,
      targetId: event.aggregateId,
      payload: { outboxId: event.id, ...event.payload },
    });
  };
}
