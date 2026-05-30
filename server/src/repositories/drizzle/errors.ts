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
