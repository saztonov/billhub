/**
 * Маппинг кодов ошибок PostgreSQL (SQLSTATE) для Drizzle-репозиториев.
 * postgres.js выбрасывает ошибки с полем `code` (SQLSTATE).
 *
 * ВАЖНО: начиная с drizzle-orm 0.44 каждый запрос оборачивает ошибку драйвера в
 * DrizzleQueryError («Failed query: ... params: ...»), у которого своих `code`/`constraint_name`
 * НЕТ — исходная ошибка postgres.js лежит в `cause`. Поэтому оба геттера идут по цепочке
 * `cause`, иначе доменные ошибки (UniqueConstraintError и т.п.) перестают распознаваться и
 * конфликты уникальности деградируют до 500 с сырым текстом запроса.
 */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_NOT_NULL_VIOLATION = '23502';

/** Предел обхода цепочки `cause` — страховка от самоссылающихся ошибок. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Первое строковое значение поля `field`, найденное на самой ошибке или в её цепочке `cause`.
 */
function findErrorField(err: unknown, field: string): string | undefined {
  let current = err;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (!current || typeof current !== 'object') return undefined;
    if (field in current) {
      const value = (current as Record<string, unknown>)[field];
      if (typeof value === 'string') return value;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Достаёт SQLSTATE-код из ошибки postgres.js (в т.ч. обёрнутой в DrizzleQueryError). */
export function getPgErrorCode(err: unknown): string | undefined {
  return findErrorField(err, 'code');
}

/**
 * Имя нарушенного ограничения (postgres.js кладёт его в constraint_name).
 * Нужно там, где в одной транзакции возможны конфликты по РАЗНЫМ уникальным индексам:
 * один 23505 нельзя трактовать как «занят email», если рядом пишутся привязки к объектам.
 */
export function getPgConstraintName(err: unknown): string | undefined {
  return findErrorField(err, 'constraint_name');
}

/** Уникальный функциональный индекс логина: UNIQUE (lower(email)) в public.users (миграция 0005). */
export const USERS_EMAIL_UNIQUE_INDEX = 'users_email_lower_unique_idx';
