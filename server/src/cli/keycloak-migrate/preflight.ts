/**
 * Ф3 — preflight-анализ (чистый, только над списком `public.users`). Делит находки на:
 *   - blocker  — всегда фейл (`--allow-anomalies` НЕ действует): импорт нельзя запускать;
 *   - warning  — допустимо при `--allow-anomalies N` (null-хэш → импорт без credentials).
 *
 * Проверки, требующие Keycloak (уже существующий KC-юзер по email), делает runner (IO), а не это ядро.
 */
import { PasswordService } from '../../services/auth/password.service.js';
import type { MigrationUser } from './types.js';

export type AnomalyLevel = 'blocker' | 'warning';

export interface Anomaly {
  level: AnomalyLevel;
  kind: string;
  userId?: string;
  email?: string;
  detail?: string;
}

export interface PreflightReport {
  total: number;
  blockers: number;
  warnings: number;
  anomalies: Anomaly[];
}

const VALID_ROLES = new Set(['admin', 'user', 'counterparty_user', 'security']);

export function analyzePreflight(users: MigrationUser[]): PreflightReport {
  const anomalies: Anomaly[] = [];

  // Дубли lower(email) и пустой email.
  const byEmail = new Map<string, MigrationUser[]>();
  for (const u of users) {
    const key = (u.email ?? '').trim().toLowerCase();
    const bucket = byEmail.get(key);
    if (bucket) bucket.push(u);
    else byEmail.set(key, [u]);
  }
  for (const [key, group] of byEmail) {
    if (key === '') {
      for (const u of group) {
        anomalies.push({ level: 'blocker', kind: 'empty_email', userId: u.id });
      }
    } else if (group.length > 1) {
      anomalies.push({
        level: 'blocker',
        kind: 'duplicate_email',
        email: key,
        detail: `${group.length} строк`,
      });
    }
  }

  // Построчные инварианты.
  for (const u of users) {
    if (u.passwordHash === null) {
      anomalies.push({ level: 'warning', kind: 'null_password', userId: u.id, email: u.email });
    } else if (!PasswordService.isBcryptHash(u.passwordHash)) {
      anomalies.push({ level: 'blocker', kind: 'invalid_bcrypt', userId: u.id, email: u.email });
    }

    if (!VALID_ROLES.has(u.role)) {
      anomalies.push({
        level: 'blocker',
        kind: 'invalid_role',
        userId: u.id,
        email: u.email,
        detail: u.role,
      });
    }

    if (u.role === 'counterparty_user' && !u.counterpartyId) {
      anomalies.push({
        level: 'blocker',
        kind: 'counterparty_missing',
        userId: u.id,
        email: u.email,
      });
    }
    if (u.role !== 'counterparty_user' && u.counterpartyId) {
      anomalies.push({
        level: 'blocker',
        kind: 'counterparty_unexpected',
        userId: u.id,
        email: u.email,
      });
    }

    if (!(u.fullName ?? '').trim()) {
      anomalies.push({ level: 'blocker', kind: 'empty_name', userId: u.id, email: u.email });
    }
  }

  const blockers = anomalies.filter((a) => a.level === 'blocker').length;
  const warnings = anomalies.filter((a) => a.level === 'warning').length;
  return { total: users.length, blockers, warnings, anomalies };
}
