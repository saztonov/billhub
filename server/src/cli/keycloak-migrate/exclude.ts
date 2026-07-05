/**
 * Ф3 доп. — исключение пользователей из ВСЕХ режимов CLI по email (`--exclude-email`). Не путать
 * с `--only-email` (тот сужает выборку для пробного сэмпла импорта). Нужен для случаев вроде
 * деактивированных тестовых/мусорных аккаунтов, которые не проходят preflight-инварианты и
 * осознанно НЕ переносятся в Keycloak (остаются в standalone-истории; после cutover у них просто
 * никогда не будет identity link — деактивированный аккаунт и не должен логиниться).
 *
 * Инвариант `counterparty_missing` и другие HARD-блокеры не ослабляются: исключённые пользователи
 * не читаются вообще, поэтому и не попадают в анализ preflight/import/verify/reconcile/report.
 */
import type { MigrationUser, SourceReader } from './types.js';

export function filterExcludedEmails(
  users: MigrationUser[],
  excludeEmails?: string[],
): MigrationUser[] {
  if (!excludeEmails?.length) return users;
  const excl = new Set(excludeEmails.map((e) => e.trim().toLowerCase()));
  return users.filter((u) => !excl.has(u.email.trim().toLowerCase()));
}

/** Оборачивает SourceReader, скрывая исключённых пользователей от всех режимов CLI. */
export function excludingSource(source: SourceReader, excludeEmails?: string[]): SourceReader {
  if (!excludeEmails?.length) return source;
  return {
    async readUsers() {
      return filterExcludedEmails(await source.readUsers(), excludeEmails);
    },
  };
}
