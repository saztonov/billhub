/**
 * DrizzleRepository для домена «Пользователь» (Iteration 4).
 *
 * В отличие от Supabase-реализации, department маппится напрямую из колонки
 * users.department_id (тип department_enum), без отдельного JOIN.
 *
 * Примечание: в БД нет UNIQUE-ограничения на users.email (уникальность обеспечивается
 * на уровне Supabase auth.users и логики приложения). Маппинг 23505→email сохранён
 * как защитный на случай добавления ограничения в будущем.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { users } from '../../db/schema/index.js';
import type { UserRepository } from '../user.repository.js';
import type { User, CreateUserBody, UpdateUserBody, ListUsersQuery } from '../../schemas/user.js';
import {
  NotFoundError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  type PaginatedResult,
} from '../types.js';
import { getPgErrorCode, PG_UNIQUE_VIOLATION, PG_FOREIGN_KEY_VIOLATION } from './errors.js';

type Db = PostgresJsDatabase<typeof schema>;
type Row = typeof users.$inferSelect;
type Department = User['department'];

function rowToDto(row: Row): User {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: row.role as User['role'],
    counterpartyId: row.counterpartyId,
    department: (row.departmentId as Department) ?? null,
    allSites: row.allSites,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async getById(id: string): Promise<User> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError('User', id);
    return found;
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? rowToDto(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ? rowToDto(row) : null;
  }

  async list(query: ListUsersQuery): Promise<PaginatedResult<User>> {
    const conditions: SQL[] = [];
    if (query.role) conditions.push(eq(users.role, query.role));
    if (query.counterpartyId) conditions.push(eq(users.counterpartyId, query.counterpartyId));
    if (query.isActive !== undefined) conditions.push(eq(users.isActive, query.isActive));
    if (query.search) {
      const term = `%${query.search}%`;
      const search = or(ilike(users.email, term), ilike(users.fullName, term));
      if (search) conditions.push(search);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(where);

    return {
      items: rows.map(rowToDto),
      totalCount: countRow?.count ?? 0,
    };
  }

  async create(body: CreateUserBody): Promise<User> {
    try {
      // users.id не имеет дефолта в БД (исторически приходил из auth.users).
      // До standalone-auth (Iteration 6) генерируем UUID в репозитории.
      const [row] = await this.db
        .insert(users)
        .values({
          id: randomUUID(),
          email: body.email,
          fullName: body.fullName,
          role: body.role,
          counterpartyId: body.counterpartyId ?? null,
          departmentId: body.department ?? null,
          allSites: body.allSites ?? false,
          isActive: body.isActive ?? true,
        })
        .returning();
      return rowToDto(row!);
    } catch (err) {
      if (getPgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        throw new UniqueConstraintError('User', 'email', body.email);
      }
      throw err;
    }
  }

  async update(id: string, body: UpdateUserBody): Promise<User> {
    const patch: Partial<typeof users.$inferInsert> = {};
    if (body.email !== undefined) patch.email = body.email;
    if (body.fullName !== undefined) patch.fullName = body.fullName;
    if (body.role !== undefined) patch.role = body.role;
    if (body.counterpartyId !== undefined) patch.counterpartyId = body.counterpartyId;
    if (body.department !== undefined) patch.departmentId = body.department;
    if (body.allSites !== undefined) patch.allSites = body.allSites;
    if (body.isActive !== undefined) patch.isActive = body.isActive;

    if (Object.keys(patch).length === 0) return this.getById(id);

    try {
      const [row] = await this.db.update(users).set(patch).where(eq(users.id, id)).returning();
      if (!row) throw new NotFoundError('User', id);
      return rowToDto(row);
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      if (getPgErrorCode(err) === PG_UNIQUE_VIOLATION && body.email) {
        throw new UniqueConstraintError('User', 'email', body.email);
      }
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const deleted = await this.db
        .delete(users)
        .where(eq(users.id, id))
        .returning({ id: users.id });
      if (deleted.length === 0) throw new NotFoundError('User', id);
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      if (getPgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION) {
        throw new ForeignKeyConstraintError('User', 'связанные записи');
      }
      throw err;
    }
  }

  async setActive(id: string, isActive: boolean): Promise<User> {
    return this.update(id, { isActive });
  }
}
