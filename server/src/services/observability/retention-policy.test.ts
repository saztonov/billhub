/**
 * Unit-тесты чистых helpers retention (dry-run: проверяем условия/арифметику без БД).
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RETENTION,
  daysAgoIso,
  monthStartUtc,
  addMonthsUtc,
  partitionName,
  partitionBoundIso,
  parsePartitionMonth,
  expiredAuditPartitions,
  missingFuturePartitions,
} from './retention-policy.js';

const NOW = new Date('2026-06-15T12:00:00.000Z');

describe('retention-policy: значения по умолчанию (5 политик)', () => {
  it('соответствуют плану §7', () => {
    expect(DEFAULT_RETENTION.outboxProcessedDays).toBe(7);
    expect(DEFAULT_RETENTION.jobsDoneDays).toBe(30);
    expect(DEFAULT_RETENTION.jobsFailedDeadDays).toBe(90);
    expect(DEFAULT_RETENTION.refreshTokensDays).toBe(30);
    expect(DEFAULT_RETENTION.passwordResetDays).toBe(7);
    expect(DEFAULT_RETENTION.auditRetentionMonths).toBe(12);
  });
});

describe('retention-policy: daysAgoIso', () => {
  it('вычитает дни', () => {
    expect(daysAgoIso(NOW, 7)).toBe('2026-06-08T12:00:00.000Z');
    expect(daysAgoIso(NOW, 30)).toBe('2026-05-16T12:00:00.000Z');
    expect(daysAgoIso(NOW, 90)).toBe('2026-03-17T12:00:00.000Z');
  });
});

describe('retention-policy: партиции', () => {
  it('monthStartUtc / addMonthsUtc (UTC, переход через год)', () => {
    expect(monthStartUtc(NOW).toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(addMonthsUtc(monthStartUtc(NOW), 7).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(addMonthsUtc(monthStartUtc(NOW), -12).toISOString()).toBe('2025-06-01T00:00:00.000Z');
  });

  it('partitionName / partitionBoundIso', () => {
    expect(partitionName(monthStartUtc(NOW))).toBe('audit_log_2026_06');
    expect(partitionBoundIso(monthStartUtc(NOW))).toBe('2026-06-01');
    expect(partitionName(new Date(Date.UTC(2026, 0, 1)))).toBe('audit_log_2026_01');
  });

  it('parsePartitionMonth: валидные/невалидные', () => {
    expect(parsePartitionMonth('audit_log_2026_06')?.toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    );
    expect(parsePartitionMonth('audit_log_default')).toBeNull();
    expect(parsePartitionMonth('audit_log_2026_13')).toBeNull();
    expect(parsePartitionMonth('users')).toBeNull();
  });

  it('expiredAuditPartitions: старше 12 месяцев → кандидаты на DROP; default не трогается', () => {
    const existing = [
      'audit_log_2025_05', // 13 мес назад → expired
      'audit_log_2025_06', // ровно 12 мес назад → НЕ expired (cutoff = 2025-06-01, строго <)
      'audit_log_2026_06', // текущий
      'audit_log_default',
    ];
    const expired = expiredAuditPartitions(existing, NOW, 12);
    expect(expired).toEqual(['audit_log_2025_05']);
    expect(expired).not.toContain('audit_log_default');
  });

  it('missingFuturePartitions: создаёт отсутствующие на текущий + N месяцев', () => {
    const existing = ['audit_log_2026_06', 'audit_log_2026_07'];
    const missing = missingFuturePartitions(existing, NOW, 12);
    // 13 слотов (0..12), 2 уже есть → 11 к созданию.
    expect(missing).toHaveLength(11);
    const first = missing[0]!;
    expect(first.name).toBe('audit_log_2026_08');
    expect(first.fromIso).toBe('2026-08-01');
    expect(first.toIso).toBe('2026-09-01');
    // последний слот — июнь 2027
    expect(missing.at(-1)!.name).toBe('audit_log_2027_06');
    expect(missing.at(-1)!.toIso).toBe('2027-07-01');
  });
});
