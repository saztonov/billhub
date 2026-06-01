/**
 * Unit-тесты мониторов: чистые пороги + эмиссия audit-события при превышении (fake-зависимости).
 */
import { describe, it, expect, vi } from 'vitest';
import { MonitorService, isConnLimitBreached, isDeadJobsBreached } from './monitors.js';
import { recordS3Result, __resetS3Samples } from './s3-error-rate.js';
import type { JobsLogRepository } from '../../repositories/jobs-log.repository.js';
import type { AuditLogService } from '../auth/audit-log.service.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

describe('monitors: чистые пороги', () => {
  it('isConnLimitBreached: >80% conn_limit', () => {
    expect(isConnLimitBreached(25, 30, 0.8)).toBe(true); // 25 > 24
    expect(isConnLimitBreached(24, 30, 0.8)).toBe(false); // ровно 24, строго >
    expect(isConnLimitBreached(10, 0, 0.8)).toBe(false); // защита от нулевого лимита
  });
  it('isDeadJobsBreached: >0', () => {
    expect(isDeadJobsBreached(0)).toBe(false);
    expect(isDeadJobsBreached(1)).toBe(true);
  });
});

function fakeAudit() {
  return { logEvent: vi.fn().mockResolvedValue(undefined) } as unknown as AuditLogService & {
    logEvent: ReturnType<typeof vi.fn>;
  };
}

const fakeJobsLog = (dead: number): JobsLogRepository => ({
  record: vi.fn(),
  countDeadSince: vi.fn().mockResolvedValue(dead),
  deleteByRetention: vi.fn(),
});

describe('MonitorService.checkDbConnections', () => {
  it('эмитит audit при превышении', async () => {
    const audit = fakeAudit();
    const db = {
      execute: vi.fn().mockResolvedValue([{ c: 25 }]),
    } as unknown as PostgresJsDatabase<never>;
    const svc = new MonitorService({
      db,
      jobsLog: fakeJobsLog(0),
      audit,
      config: { runtimeUser: 'billhub_runtime', connLimit: 30 },
    });
    const res = await svc.checkDbConnections();
    expect(res).toMatchObject({ active: 25, breached: true });
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'db_connections_high' }),
    );
  });

  it('не эмитит при норме', async () => {
    const audit = fakeAudit();
    const db = {
      execute: vi.fn().mockResolvedValue([{ c: 5 }]),
    } as unknown as PostgresJsDatabase<never>;
    const svc = new MonitorService({
      db,
      jobsLog: fakeJobsLog(0),
      audit,
      config: { runtimeUser: 'billhub_runtime', connLimit: 30 },
    });
    expect((await svc.checkDbConnections()).breached).toBe(false);
    expect(audit.logEvent).not.toHaveBeenCalled();
  });
});

describe('MonitorService.checkDeadJobs', () => {
  it('эмитит при dead>0', async () => {
    const audit = fakeAudit();
    const svc = new MonitorService({
      db: {} as unknown as PostgresJsDatabase<never>,
      jobsLog: fakeJobsLog(2),
      audit,
      config: { runtimeUser: 'u', connLimit: 30 },
    });
    const res = await svc.checkDeadJobs();
    expect(res).toMatchObject({ count: 2, breached: true });
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'dead_jobs_detected' }),
    );
  });
});

describe('MonitorService.checkS3ErrorRate', () => {
  it('эмитит при error-rate >5% с достаточным числом сэмплов', async () => {
    __resetS3Samples();
    let t = 1_000;
    const now = () => t;
    for (let i = 0; i < 80; i += 1) recordS3Result(true, now);
    for (let i = 0; i < 20; i += 1) recordS3Result(false, now);
    const audit = fakeAudit();
    const svc = new MonitorService({
      db: {} as unknown as PostgresJsDatabase<never>,
      jobsLog: fakeJobsLog(0),
      audit,
      config: { runtimeUser: 'u', connLimit: 30 },
      now,
    });
    const res = await svc.checkS3ErrorRate();
    expect(res.breached).toBe(true);
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 's3_error_rate_high' }),
    );
  });
});
