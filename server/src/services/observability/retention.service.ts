/**
 * RetentionService — применение 5 retention-политик + обслуживание партиций audit_log
 * (план Iteration 7, §7). Запускается ночным BullMQ recurring job (plugins/maintenance.ts).
 *
 * Каждый прогон логируется в audit_log как «retention.cleanup» с числом удалённых строк.
 * Условия DELETE и арифметика партиций вынесены в чистый retention-policy.ts (unit-тесты).
 *
 * Идентификаторы партиций для CREATE/DROP подставляются через sql.raw, поэтому строго
 * валидируются регэкспом (^audit_log_\d{4}_\d{2}$ / ^\d{4}-\d{2}-\d{2}$) — защита от инъекции.
 */
import { and, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { passwordResetTokens, refreshTokens } from '../../db/schema/index.js';
import type { OutboxRepository } from '../../repositories/outbox.repository.js';
import type { JobsLogRepository } from '../../repositories/jobs-log.repository.js';
import type { AuditLogService } from '../auth/audit-log.service.js';
import {
  DEFAULT_RETENTION,
  daysAgoIso,
  expiredAuditPartitions,
  missingFuturePartitions,
  type RetentionConfig,
} from './retention-policy.js';

type Db = PostgresJsDatabase<typeof schema>;

const PARTITION_NAME_RE = /^audit_log_\d{4}_\d{2}$/;
const BOUND_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface RetentionResult {
  outboxDeleted: number;
  jobsLogDeleted: number;
  refreshTokensDeleted: number;
  passwordResetDeleted: number;
  auditPartitionsCreated: string[];
  auditPartitionsDropped: string[];
}

export interface RetentionServiceDeps {
  db: Db;
  outbox: OutboxRepository;
  jobsLog: JobsLogRepository;
  audit: AuditLogService;
  config?: RetentionConfig;
}

export class RetentionService {
  private readonly cfg: RetentionConfig;

  constructor(private readonly deps: RetentionServiceDeps) {
    this.cfg = deps.config ?? DEFAULT_RETENTION;
  }

  /** Прогон всех политик. now инъектируется (тесты); по умолчанию текущее время. */
  async runAll(now: Date = new Date()): Promise<RetentionResult> {
    const outboxDeleted = await this.deps.outbox.deleteProcessedOlderThan(
      daysAgoIso(now, this.cfg.outboxProcessedDays),
    );
    const jobsLogDeleted = await this.deps.jobsLog.deleteByRetention(
      daysAgoIso(now, this.cfg.jobsDoneDays),
      daysAgoIso(now, this.cfg.jobsFailedDeadDays),
    );
    const refreshTokensDeleted = await this.cleanRefreshTokens(now);
    const passwordResetDeleted = await this.cleanPasswordResets(now);
    const { created, dropped } = await this.maintainAuditPartitions(now);

    const result: RetentionResult = {
      outboxDeleted,
      jobsLogDeleted,
      refreshTokensDeleted,
      passwordResetDeleted,
      auditPartitionsCreated: created,
      auditPartitionsDropped: dropped,
    };

    await this.deps.audit.logEvent({
      eventType: 'retention.cleanup',
      payload: { ...result },
    });
    return result;
  }

  /** refresh_tokens: revoked/expired и issued_at старше N дней. */
  private async cleanRefreshTokens(now: Date): Promise<number> {
    const nowIso = now.toISOString();
    const cutoff = daysAgoIso(now, this.cfg.refreshTokensDays);
    const res = await this.deps.db
      .delete(refreshTokens)
      .where(
        and(
          or(isNotNull(refreshTokens.revokedAt), lt(refreshTokens.expiresAt, nowIso)),
          lt(refreshTokens.issuedAt, cutoff),
        ),
      )
      .returning({ id: refreshTokens.id });
    return res.length;
  }

  /** password_reset_tokens: used/expired и expires_at старше N дней. */
  private async cleanPasswordResets(now: Date): Promise<number> {
    const nowIso = now.toISOString();
    const cutoff = daysAgoIso(now, this.cfg.passwordResetDays);
    const res = await this.deps.db
      .delete(passwordResetTokens)
      .where(
        and(
          or(isNotNull(passwordResetTokens.usedAt), lt(passwordResetTokens.expiresAt, nowIso)),
          lt(passwordResetTokens.expiresAt, cutoff),
        ),
      )
      .returning({ id: passwordResetTokens.id });
    return res.length;
  }

  /** Имена дата-партиций audit_log (без _default). */
  private async listAuditPartitions(): Promise<string[]> {
    const res = await this.deps.db.execute(sql`
      SELECT c.relname AS relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'audit_log'
    `);
    const rows = res as unknown as Array<{ relname: string }>;
    return rows.map((r) => r.relname).filter((n) => PARTITION_NAME_RE.test(n));
  }

  /** create-ahead будущих партиций + DROP протухших. */
  private async maintainAuditPartitions(
    now: Date,
  ): Promise<{ created: string[]; dropped: string[] }> {
    const existing = await this.listAuditPartitions();

    const created: string[] = [];
    for (const p of missingFuturePartitions(existing, now, this.cfg.auditPartitionsAhead)) {
      if (!PARTITION_NAME_RE.test(p.name) || !BOUND_RE.test(p.fromIso) || !BOUND_RE.test(p.toIso)) {
        continue;
      }
      await this.deps.db.execute(
        sql.raw(
          `CREATE TABLE IF NOT EXISTS public.${p.name} PARTITION OF public.audit_log ` +
            `FOR VALUES FROM ('${p.fromIso}') TO ('${p.toIso}')`,
        ),
      );
      created.push(p.name);
    }

    const dropped: string[] = [];
    for (const name of expiredAuditPartitions(existing, now, this.cfg.auditRetentionMonths)) {
      if (!PARTITION_NAME_RE.test(name)) continue;
      await this.deps.db.execute(sql.raw(`DROP TABLE IF EXISTS public.${name}`));
      dropped.push(name);
    }

    return { created, dropped };
  }
}
