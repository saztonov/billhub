/**
 * Маппинг кодов ошибок PostgreSQL (SQLSTATE) для Drizzle-репозиториев.
 * postgres.js выбрасывает ошибки с полем `code` (SQLSTATE).
 */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_NOT_NULL_VIOLATION = '23502';

/** Достаёт SQLSTATE-код из ошибки postgres.js, если он есть. */
export function getPgErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * Имя нарушенного ограничения (postgres.js кладёт его в constraint_name).
 * Нужно там, где в одной транзакции возможны конфликты по РАЗНЫМ уникальным индексам:
 * один 23505 нельзя трактовать как «занят email», если рядом пишутся привязки к объектам.
 */
export function getPgConstraintName(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'constraint_name' in err) {
    const name = (err as { constraint_name?: unknown }).constraint_name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

/** Уникальный функциональный индекс логина: UNIQUE (lower(email)) в public.users (миграция 0005). */
export const USERS_EMAIL_UNIQUE_INDEX = 'users_email_lower_unique_idx';
