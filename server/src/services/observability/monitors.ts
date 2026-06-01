/**
 * Мониторы Этапа 1 (план Iteration 7, §7): соединения БД, dead jobs, S3 error-rate.
 * Запускаются BullMQ recurring jobs (plugins/maintenance.ts). При превышении порога —
 * audit-событие (а не Sentry: Этап 1 — error_logs + audit_log + pino, ADR-0001 §20).
 *
 * Пороговые функции (isConnLimitBreached / isDeadJobsBreached) — чистые, unit-тестируемы.
 * S3 error-rate — из s3-error-rate.ts (in-memory счётчик в воркерах).
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import type { JobsLogRepository } from '../../repositories/jobs-log.repository.js';
import type { AuditLogService } from '../auth/audit-log.service.js';
import {
  isS3ErrorRateBreached,
  s3ErrorRateLastMinute,
  type S3RateSnapshot,
} from './s3-error-rate.js';

type Db = PostgresJsDatabase<typeof schema>;

/** Превышение лимита соединений: active > connLimit * ratio (по умолчанию 80%). */
export function isConnLimitBreached(active: number, connLimit: number, ratio = 0.8): boolean {
  return connLimit > 0 && active > connLimit * ratio;
}

/** Алерт dead jobs: любое dead-задание в окне. */
export function isDeadJobsBreached(count: number): boolean {
  return count > 0;
}

export interface MonitorConfig {
  /** Пользователь runtime для подсчёта соединений (billhub_runtime). */
  runtimeUser: string;
  /** conn_limit пользователя runtime (ADR-5: 30). */
  connLimit: number;
  /** Доля от conn_limit для алерта (по умолчанию 0.8). */
  connRatio?: number;
}

export interface MonitorServiceDeps {
  db: Db;
  jobsLog: JobsLogRepository;
  audit: AuditLogService;
  config: MonitorConfig;
  now?: () => number;
}

export class MonitorService {
  private readonly now: () => number;

  constructor(private readonly deps: MonitorServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Соединения billhub_runtime в pg_stat_activity → алерт при >80% conn_limit. */
  async checkDbConnections(): Promise<{ active: number; breached: boolean }> {
    const res = await this.deps.db.execute(sql`
      SELECT count(*)::int AS c FROM pg_stat_activity WHERE usename = ${this.deps.config.runtimeUser}
    `);
    const rows = res as unknown as Array<{ c: number }>;
    const active = Number(rows[0]?.c ?? 0);
    const breached = isConnLimitBreached(
      active,
      this.deps.config.connLimit,
      this.deps.config.connRatio,
    );
    if (breached) {
      await this.deps.audit.logEvent({
        eventType: 'db_connections_high',
        payload: { active, connLimit: this.deps.config.connLimit },
      });
    }
    return { active, breached };
  }

  /** Dead jobs за последний час → алерт при >0. */
  async checkDeadJobs(): Promise<{ count: number; breached: boolean }> {
    const sinceIso = new Date(this.now() - 3_600_000).toISOString();
    const count = await this.deps.jobsLog.countDeadSince(sinceIso);
    const breached = isDeadJobsBreached(count);
    if (breached) {
      await this.deps.audit.logEvent({
        eventType: 'dead_jobs_detected',
        payload: { count, windowMinutes: 60 },
      });
    }
    return { count, breached };
  }

  /** S3 error-rate за последнюю минуту → алерт при >5%. */
  async checkS3ErrorRate(): Promise<{ snapshot: S3RateSnapshot; breached: boolean }> {
    const snapshot = s3ErrorRateLastMinute(this.now);
    const breached = isS3ErrorRateBreached(snapshot);
    if (breached) {
      await this.deps.audit.logEvent({
        eventType: 's3_error_rate_high',
        payload: { total: snapshot.total, errors: snapshot.errors, errorRate: snapshot.errorRate },
      });
    }
    return { snapshot, breached };
  }
}
