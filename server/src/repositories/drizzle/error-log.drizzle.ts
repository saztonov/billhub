/**
 * DrizzleErrorLogRepository (Iteration 5). Логи ошибок; create/delete — в транзакции.
 * Форма строки списка повторяет Supabase-embed: error_logs.* + вложенный users:{email}|null.
 */
import { and, count, desc, eq, getTableColumns, gte, inArray, lt, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SQL } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import { errorLogs, users } from '../../db/schema/index.js';
import type { ErrorLogRepository, ErrorLogListFilter, Row } from '../error-log.repository.js';
import type { CreateErrorLogBody } from '../../schemas/error-log.js';

type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleErrorLogRepository implements ErrorLogRepository {
  constructor(private readonly db: Db) {}

  async list(filter: ErrorLogListFilter): Promise<{ data: Row[]; total: number }> {
    const conds: SQL[] = [];
    if (filter.errorTypes && filter.errorTypes.length > 0) {
      conds.push(inArray(errorLogs.errorType, filter.errorTypes));
    }
    if (filter.dateFrom) conds.push(gte(errorLogs.createdAt, filter.dateFrom));
    if (filter.dateTo) conds.push(lte(errorLogs.createdAt, filter.dateTo + 'T23:59:59.999Z'));
    const where = conds.length ? and(...conds) : undefined;

    const from = (filter.page - 1) * filter.pageSize;
    const rows = await this.db
      .select({ ...getTableColumns(errorLogs), userEmail: users.email })
      .from(errorLogs)
      .leftJoin(users, eq(users.id, errorLogs.userId))
      .where(where)
      .orderBy(desc(errorLogs.createdAt))
      .limit(filter.pageSize)
      .offset(from);

    const [c] = await this.db.select({ c: count() }).from(errorLogs).where(where);

    const data = rows.map(({ userEmail, ...rest }) => ({
      ...rest,
      users: userEmail != null ? { email: userEmail } : null,
    }));
    return { data, total: Number(c?.c ?? 0) };
  }

  async create(input: CreateErrorLogBody & { userId: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(errorLogs).values({
        errorType: input.errorType,
        errorMessage: input.errorMessage,
        errorStack: input.errorStack || null,
        url: input.url || null,
        userId: input.userId,
        userAgent: input.userAgent || null,
        component: input.component || null,
        metadata: input.metadata || null,
      });
    });
  }

  async deleteOlderThan(cutoffIso: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(errorLogs).where(lt(errorLogs.createdAt, cutoffIso));
    });
  }
}
