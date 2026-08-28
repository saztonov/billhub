/**
 * Регрессия на извлечение SQLSTATE из ошибок драйвера.
 *
 * drizzle-orm 0.44+ оборачивает ошибку postgres.js в DrizzleQueryError, у которого нет
 * собственных code/constraint_name. Если геттеры перестанут разворачивать `cause`, весь
 * маппинг PG-ошибок в доменные (UniqueConstraintError и др.) молча отключится, и конфликт
 * уникальности вернётся клиенту как 500 с текстом SQL-запроса.
 */
import { describe, it, expect } from 'vitest';
import {
  getPgErrorCode,
  getPgConstraintName,
  PG_UNIQUE_VIOLATION,
  USERS_EMAIL_UNIQUE_INDEX,
} from './errors.js';

/** Упрощённая копия ошибки postgres.js. */
function pgError(): Error & { code: string; constraint_name: string } {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: PG_UNIQUE_VIOLATION,
    constraint_name: USERS_EMAIL_UNIQUE_INDEX,
  });
}

/** Упрощённая копия DrizzleQueryError: текст запроса + исходная ошибка в cause. */
function drizzleWrap(cause: unknown): Error {
  return Object.assign(new Error('Failed query: insert into "users" ...\nparams: a@b.ru'), {
    cause,
  });
}

describe('getPgErrorCode / getPgConstraintName', () => {
  it('читает поля с самой ошибки postgres.js', () => {
    const err = pgError();
    expect(getPgErrorCode(err)).toBe(PG_UNIQUE_VIOLATION);
    expect(getPgConstraintName(err)).toBe(USERS_EMAIL_UNIQUE_INDEX);
  });

  it('разворачивает ошибку, обёрнутую в DrizzleQueryError', () => {
    const err = drizzleWrap(pgError());
    expect(getPgErrorCode(err)).toBe(PG_UNIQUE_VIOLATION);
    expect(getPgConstraintName(err)).toBe(USERS_EMAIL_UNIQUE_INDEX);
  });

  it('разворачивает вложенные обёртки', () => {
    const err = drizzleWrap(drizzleWrap(pgError()));
    expect(getPgErrorCode(err)).toBe(PG_UNIQUE_VIOLATION);
  });

  it('возвращает undefined для ошибок без SQLSTATE', () => {
    expect(getPgErrorCode(new Error('boom'))).toBeUndefined();
    expect(getPgConstraintName(new Error('boom'))).toBeUndefined();
    expect(getPgErrorCode(undefined)).toBeUndefined();
  });

  it('не зацикливается на самоссылающейся цепочке cause', () => {
    const err: Error & { cause?: unknown } = new Error('loop');
    err.cause = err;
    expect(getPgErrorCode(err)).toBeUndefined();
  });
});
