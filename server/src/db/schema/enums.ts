/**
 * Postgres enum-типы (источник правды — SQL-миграции, принцип 6).
 */
import { pgEnum } from 'drizzle-orm/pg-core';

// 'rp' — департамент этапа согласования «РП» (миграция 0015): используется только
// в approval_decisions.department_id, пользователям (users.department_id) не назначается.
export const departmentEnum = pgEnum('department_enum', ['omts', 'shtab', 'smetny', 'rp']);
