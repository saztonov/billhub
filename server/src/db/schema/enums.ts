/**
 * Postgres enum-типы (источник правды — SQL-миграции, принцип 6).
 */
import { pgEnum } from 'drizzle-orm/pg-core';

export const departmentEnum = pgEnum('department_enum', ['omts', 'shtab', 'smetny']);
