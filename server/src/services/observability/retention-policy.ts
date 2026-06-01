/**
 * Чистые helpers retention-политик (план Iteration 7, §7). Без БД и без Date.now() внутри —
 * время инъектируется (now: Date), что делает их полностью unit-тестируемыми.
 *
 * 5 политик retention:
 *   - audit_log:             партиции старше auditRetentionMonths (12 мес) → DROP PARTITION.
 *   - outbox:                processed_at < now() - outboxProcessedDays (7д) → DELETE.
 *   - jobs_log:              status='done' < now() - jobsDoneDays (30д) и
 *                            status in (failed,dead) < now() - jobsFailedDeadDays (90д) → DELETE.
 *   - refresh_tokens:        (revoked_at IS NOT NULL OR expires_at < now())
 *                            AND issued_at < now() - refreshTokensDays (30д) → DELETE.
 *                            [issued_at — возрастной столбец таблицы; created_at в схеме нет.]
 *   - password_reset_tokens: (used_at IS NOT NULL OR expires_at < now())
 *                            AND expires_at < now() - passwordResetDays (7д) → DELETE.
 *                            [expires_at — возрастной прокси; created_at в схеме нет.]
 */

export interface RetentionConfig {
  outboxProcessedDays: number;
  jobsDoneDays: number;
  jobsFailedDeadDays: number;
  refreshTokensDays: number;
  passwordResetDays: number;
  auditRetentionMonths: number;
  /** Сколько будущих партиций audit_log поддерживать (create-ahead). */
  auditPartitionsAhead: number;
}

export const DEFAULT_RETENTION: RetentionConfig = {
  outboxProcessedDays: 7,
  jobsDoneDays: 30,
  jobsFailedDeadDays: 90,
  refreshTokensDays: 30,
  passwordResetDays: 7,
  auditRetentionMonths: 12,
  auditPartitionsAhead: 12,
};

const DAY_MS = 86_400_000;

/** ISO момента (now - days). */
export function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Первое число месяца now (UTC). */
export function monthStartUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Первое число месяца через n месяцев от d (UTC; n может быть отрицательным). */
export function addMonthsUtc(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

/** Имя месячной партиции: audit_log_YYYY_MM. */
export function partitionName(monthStart: Date): string {
  return `audit_log_${monthStart.getUTCFullYear()}_${pad2(monthStart.getUTCMonth() + 1)}`;
}

/** Дата-граница партиции (YYYY-MM-01) для FOR VALUES. */
export function partitionBoundIso(monthStart: Date): string {
  return `${monthStart.getUTCFullYear()}-${pad2(monthStart.getUTCMonth() + 1)}-01`;
}

/** Парсит audit_log_YYYY_MM → первое число месяца (UTC), либо null (не дата-партиция). */
export function parsePartitionMonth(name: string): Date | null {
  const m = /^audit_log_(\d{4})_(\d{2})$/.exec(name);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1));
}

/** Имена дата-партиций audit_log старше retentionMonths (кандидаты на DROP). _default не трогаем. */
export function expiredAuditPartitions(
  existing: string[],
  now: Date,
  retentionMonths: number,
): string[] {
  const cutoff = addMonthsUtc(monthStartUtc(now), -retentionMonths);
  return existing.filter((name) => {
    const d = parsePartitionMonth(name);
    return d !== null && d.getTime() < cutoff.getTime();
  });
}

export interface FuturePartition {
  name: string;
  fromIso: string;
  toIso: string;
}

/** Отсутствующие партиции на текущий + monthsAhead месяцев (кандидаты на CREATE). */
export function missingFuturePartitions(
  existing: string[],
  now: Date,
  monthsAhead: number,
): FuturePartition[] {
  const have = new Set(existing);
  const base = monthStartUtc(now);
  const out: FuturePartition[] = [];
  for (let i = 0; i <= monthsAhead; i += 1) {
    const from = addMonthsUtc(base, i);
    const name = partitionName(from);
    if (have.has(name)) continue;
    const to = addMonthsUtc(base, i + 1);
    out.push({ name, fromIso: partitionBoundIso(from), toIso: partitionBoundIso(to) });
  }
  return out;
}
