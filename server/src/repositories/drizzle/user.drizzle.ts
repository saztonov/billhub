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
import {
  users,
  userConstructionSitesMapping,
  counterparties,
  constructionSites,
  notifications,
} from '../../db/schema/index.js';
import type {
  UserRepository,
  UserSitesUpdate,
  CounterpartyUserRecord,
} from '../user.repository.js';
import type {
  User,
  CreateUserBody,
  UpdateUserBody,
  ListUsersQuery,
  UserDetail,
} from '../../schemas/user.js';
import {
  NotFoundError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  ValidationError,
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

  async create(body: CreateUserBody, id?: string): Promise<User> {
    try {
      // users.id не имеет дефолта в БД (исторически приходил из auth.users).
      // До standalone-auth (Iteration 6) генерируем UUID в репозитории; keycloak admin-create
      // передаёт заранее сгенерированный id (он же billhub_user_id в KC).
      const [row] = await this.db
        .insert(users)
        .values({
          id: id ?? randomUUID(),
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

  async listWithDetails(): Promise<UserDetail[]> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        counterpartyId: users.counterpartyId,
        counterpartyName: counterparties.name,
        department: users.departmentId,
        allSites: users.allSites,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(counterparties, eq(counterparties.id, users.counterpartyId))
      .orderBy(desc(users.createdAt));

    const mappings = await this.db
      .select({
        userId: userConstructionSitesMapping.userId,
        siteId: userConstructionSitesMapping.constructionSiteId,
        siteName: constructionSites.name,
      })
      .from(userConstructionSitesMapping)
      .leftJoin(
        constructionSites,
        eq(constructionSites.id, userConstructionSitesMapping.constructionSiteId),
      );

    const byUser = new Map<string, { ids: string[]; names: string[] }>();
    for (const m of mappings) {
      if (!byUser.has(m.userId)) byUser.set(m.userId, { ids: [], names: [] });
      const e = byUser.get(m.userId)!;
      e.ids.push(m.siteId);
      e.names.push(m.siteName ?? '');
    }

    return rows.map((r) => {
      const sites = byUser.get(r.id) ?? { ids: [], names: [] };
      return {
        id: r.id,
        email: r.email,
        fullName: r.fullName,
        role: r.role,
        counterpartyId: r.counterpartyId,
        counterpartyName: r.counterpartyName ?? null,
        department: r.department ?? null,
        allSites: r.allSites,
        isActive: r.isActive,
        siteIds: sites.ids,
        siteNames: sites.names,
        createdAt: r.createdAt,
      };
    });
  }

  async getWithDetails(id: string): Promise<UserDetail> {
    const [r] = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        counterpartyId: users.counterpartyId,
        counterpartyName: counterparties.name,
        department: users.departmentId,
        allSites: users.allSites,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(counterparties, eq(counterparties.id, users.counterpartyId))
      .where(eq(users.id, id))
      .limit(1);
    if (!r) throw new NotFoundError('User', id);

    const mappings = await this.db
      .select({
        siteId: userConstructionSitesMapping.constructionSiteId,
        siteName: constructionSites.name,
      })
      .from(userConstructionSitesMapping)
      .leftJoin(
        constructionSites,
        eq(constructionSites.id, userConstructionSitesMapping.constructionSiteId),
      )
      .where(eq(userConstructionSitesMapping.userId, id));

    return {
      id: r.id,
      email: r.email,
      fullName: r.fullName,
      role: r.role,
      counterpartyId: r.counterpartyId,
      counterpartyName: r.counterpartyName ?? null,
      department: r.department ?? null,
      allSites: r.allSites,
      isActive: r.isActive,
      siteIds: mappings.map((m) => m.siteId),
      siteNames: mappings.map((m) => m.siteName ?? ''),
      createdAt: r.createdAt,
    };
  }

  async getSiteAccess(id: string): Promise<{ allSites: boolean; siteIds: string[] }> {
    const [u] = await this.db
      .select({ allSites: users.allSites })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!u) throw new NotFoundError('User', id);
    const mappings = await this.db
      .select({ siteId: userConstructionSitesMapping.constructionSiteId })
      .from(userConstructionSitesMapping)
      .where(eq(userConstructionSitesMapping.userId, id));
    return { allSites: u.allSites, siteIds: mappings.map((m) => m.siteId) };
  }

  async getSiteMappingIds(id: string): Promise<{ constructionSiteId: string }[]> {
    const rows = await this.db
      .select({ constructionSiteId: userConstructionSitesMapping.constructionSiteId })
      .from(userConstructionSitesMapping)
      .where(eq(userConstructionSitesMapping.userId, id));
    return rows;
  }

  async updateWithSites(id: string, input: UserSitesUpdate): Promise<void> {
    const { fullName, role, counterpartyId, department, allSites, siteIds } = input;
    if (department === 'shtab' && !allSites) {
      if (siteIds.length === 0) {
        throw new ValidationError('Для подразделения Штаб необходимо выбрать хотя бы один объект');
      }
      if (siteIds.length > 2) {
        throw new ValidationError('Для подразделения Штаб можно выбрать не более 2 объектов');
      }
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          fullName,
          role,
          counterpartyId: role === 'counterparty_user' ? counterpartyId : null,
          departmentId: role !== 'counterparty_user' ? (department as Department) : null,
          allSites: role === 'counterparty_user' ? false : allSites,
        })
        .where(eq(users.id, id));

      await tx
        .delete(userConstructionSitesMapping)
        .where(eq(userConstructionSitesMapping.userId, id));

      if (!allSites && role !== 'counterparty_user' && siteIds.length > 0) {
        await tx
          .insert(userConstructionSitesMapping)
          .values(siteIds.map((siteId) => ({ userId: id, constructionSiteId: siteId })));
      }

      if (department && role !== 'counterparty_user') {
        const dep = department as Exclude<Department, null>;
        const notifs = await tx
          .select({ siteId: notifications.siteId })
          .from(notifications)
          .where(
            and(
              eq(notifications.type, 'missing_specialist'),
              eq(notifications.resolved, false),
              eq(notifications.departmentId, dep),
            ),
          );
        const now = new Date().toISOString();
        for (const n of notifs) {
          const matches = allSites || (n.siteId !== null && siteIds.includes(n.siteId));
          // site_id IS NULL никогда не совпадает по равенству (как .eq в исходном коде) — пропускаем.
          if (matches && n.siteId !== null) {
            await tx
              .update(notifications)
              .set({ resolved: true, resolvedAt: now })
              .where(
                and(
                  eq(notifications.type, 'missing_specialist'),
                  eq(notifications.resolved, false),
                  eq(notifications.departmentId, dep),
                  eq(notifications.siteId, n.siteId),
                ),
              );
          }
        }
      }
    });
  }

  async setSiteMappings(id: string, siteIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(userConstructionSitesMapping)
        .where(eq(userConstructionSitesMapping.userId, id));
      if (siteIds.length > 0) {
        await tx
          .insert(userConstructionSitesMapping)
          .values(siteIds.map((siteId) => ({ userId: id, constructionSiteId: siteId })));
      }
    });
  }

  async createCounterpartyUserRecord(input: CounterpartyUserRecord): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: input.id,
        email: input.email,
        fullName: input.fullName,
        role: 'counterparty_user',
        counterpartyId: input.counterpartyId,
        allSites: false,
        // Новые пользователи по умолчанию неактивны (активирует админ). Таблица имеет
        // default is_active=true, поэтому задаём явно.
        isActive: input.isActive ?? false,
      });
    });
  }
}
