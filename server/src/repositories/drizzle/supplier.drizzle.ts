/**
 * DrizzleRepository для домена «Поставщик» (Iteration 4).
 * list() вызывает SQL-функцию list_suppliers_with_sb через db.execute.
 */
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { suppliers, supplierSecurityChecks, users, notifications } from '../../db/schema/index.js';
import type { SupplierRepository, SupplierApiListQuery, Actor } from '../supplier.repository.js';
import type {
  Supplier,
  CreateSupplierBody,
  UpdateSupplierBody,
  ListSuppliersQuery,
  SupplierListItem,
  SupplierSecurityCheck,
  SupplierSecurityEventType,
  SupplierSecurityDecisionBody,
} from '../../schemas/supplier.js';
import {
  NotFoundError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  ConflictError,
  ValidationError,
  type PaginatedResult,
} from '../types.js';
import { getPgErrorCode, PG_UNIQUE_VIOLATION, PG_FOREIGN_KEY_VIOLATION } from './errors.js';

type Db = PostgresJsDatabase<typeof schema>;
type Row = typeof suppliers.$inferSelect;

function rowToDto(row: Row): Supplier {
  return {
    id: row.id,
    name: row.name,
    inn: row.inn,
    alternativeNames: row.alternativeNames ?? [],
    createdAt: row.createdAt,
    foundingDocumentsComment: row.foundingDocumentsComment,
    lastSecurityStatus: (row.lastSecurityStatus as 'approved' | 'rejected' | null) ?? null,
  };
}

function checkToDto(
  row: {
    id: string;
    supplierId: string;
    authorId: string;
    eventType: string;
    comment: string | null;
    createdAt: string;
  },
  authorFullName: string,
): SupplierSecurityCheck {
  return {
    id: row.id,
    supplierId: row.supplierId,
    authorId: row.authorId,
    authorFullName,
    eventType: row.eventType as SupplierSecurityEventType,
    comment: row.comment,
    createdAt: row.createdAt,
  };
}

/** Строка, возвращаемая SQL-функцией list_suppliers_with_sb. */
interface SbRow {
  id: string;
  name: string;
  inn: string;
  alternative_names: string[] | null;
  created_at: string;
  last_security_status: 'approved' | 'rejected' | null;
  has_pending_request: boolean;
  total_count: number | string;
}

export class DrizzleSupplierRepository implements SupplierRepository {
  constructor(private readonly db: Db) {}

  async getById(id: string): Promise<Supplier> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError('Supplier', id);
    return found;
  }

  async findById(id: string): Promise<Supplier | null> {
    const [row] = await this.db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
    return row ? rowToDto(row) : null;
  }

  async findByInn(inn: string): Promise<Supplier | null> {
    const [row] = await this.db.select().from(suppliers).where(eq(suppliers.inn, inn)).limit(1);
    return row ? rowToDto(row) : null;
  }

  async list(query: ListSuppliersQuery): Promise<PaginatedResult<Supplier>> {
    const rows = (await this.db.execute(
      sql`SELECT * FROM list_suppliers_with_sb(
        ${query.search ?? null},
        ${query.sbFilter},
        ${query.page},
        ${query.pageSize},
        ${query.cutoffDate ?? null},
        ${query.onlySupplierId ?? null}
      )`,
    )) as unknown as SbRow[];

    if (rows.length === 0 || !rows[0]) return { items: [], totalCount: 0 };

    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        inn: r.inn,
        alternativeNames: r.alternative_names ?? [],
        createdAt: r.created_at,
        lastSecurityStatus: r.last_security_status,
        hasPendingRequest: r.has_pending_request,
      })),
      totalCount: Number(rows[0].total_count),
    };
  }

  async create(body: CreateSupplierBody): Promise<Supplier> {
    try {
      const [row] = await this.db
        .insert(suppliers)
        .values({
          name: body.name,
          inn: body.inn,
          alternativeNames: body.alternativeNames ?? [],
        })
        .returning();
      return rowToDto(row!);
    } catch (err) {
      if (getPgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        throw new UniqueConstraintError('Supplier', 'inn', body.inn);
      }
      throw err;
    }
  }

  async update(id: string, body: UpdateSupplierBody): Promise<Supplier> {
    const patch: Partial<typeof suppliers.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.inn !== undefined) patch.inn = body.inn;
    if (body.alternativeNames !== undefined) patch.alternativeNames = body.alternativeNames;
    if (body.foundingDocumentsComment !== undefined) {
      patch.foundingDocumentsComment = body.foundingDocumentsComment;
    }

    if (Object.keys(patch).length === 0) return this.getById(id);

    try {
      const [row] = await this.db
        .update(suppliers)
        .set(patch)
        .where(eq(suppliers.id, id))
        .returning();
      if (!row) throw new NotFoundError('Supplier', id);
      return rowToDto(row);
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      if (getPgErrorCode(err) === PG_UNIQUE_VIOLATION && body.inn) {
        throw new UniqueConstraintError('Supplier', 'inn', body.inn);
      }
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const deleted = await this.db
        .delete(suppliers)
        .where(eq(suppliers.id, id))
        .returning({ id: suppliers.id });
      if (deleted.length === 0) throw new NotFoundError('Supplier', id);
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      if (getPgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION) {
        throw new ForeignKeyConstraintError('Supplier', 'связанные договоры');
      }
      throw err;
    }
  }

  async listAll(): Promise<Supplier[]> {
    const rows = await this.db.select().from(suppliers).orderBy(desc(suppliers.createdAt));
    return rows.map(rowToDto);
  }

  async batchCreate(rows: { name: string; inn: string }[]): Promise<number> {
    if (rows.length === 0) return 0;
    return this.db.transaction(async (tx) => {
      await tx
        .insert(suppliers)
        .values(rows.map((r) => ({ name: r.name, inn: r.inn, alternativeNames: [] })));
      return rows.length;
    });
  }

  async listForApi(
    query: SupplierApiListQuery,
  ): Promise<{ items: SupplierListItem[]; total: number }> {
    const rows = (await this.db.execute(
      sql`SELECT * FROM list_suppliers_with_sb(
        ${query.search ?? null},
        ${query.sbFilter},
        ${query.page},
        ${query.pageSize},
        ${query.cutoffDate},
        ${null}
      )`,
    )) as unknown as Array<{
      id: string;
      name: string;
      inn: string;
      alternative_names: string[] | null;
      created_at: string;
      last_security_status: 'approved' | 'rejected' | null;
      last_security_at: string | null;
      has_pending_request: boolean;
      total_count: number | string;
    }>;
    const total = rows.length > 0 && rows[0] ? Number(rows[0].total_count) : 0;
    const items: SupplierListItem[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      inn: row.inn,
      alternativeNames: row.alternative_names ?? [],
      createdAt: row.created_at,
      lastSecurityCheck:
        row.last_security_status && row.last_security_at
          ? { status: row.last_security_status, createdAt: row.last_security_at }
          : null,
      hasPendingRequest: !!row.has_pending_request,
    }));
    return { items, total };
  }

  async isSbRejected(supplierId: string | null | undefined): Promise<boolean> {
    if (!supplierId) return false;
    const found = await this.findById(supplierId);
    return found?.lastSecurityStatus === 'rejected';
  }

  async getSecurityHistory(supplierId: string): Promise<SupplierSecurityCheck[]> {
    const rows = await this.db
      .select({
        id: supplierSecurityChecks.id,
        supplierId: supplierSecurityChecks.supplierId,
        authorId: supplierSecurityChecks.authorId,
        eventType: supplierSecurityChecks.eventType,
        comment: supplierSecurityChecks.comment,
        createdAt: supplierSecurityChecks.createdAt,
        authorFullName: users.fullName,
      })
      .from(supplierSecurityChecks)
      .leftJoin(users, eq(users.id, supplierSecurityChecks.authorId))
      .where(eq(supplierSecurityChecks.supplierId, supplierId))
      .orderBy(desc(supplierSecurityChecks.createdAt));
    return rows.map((r) => checkToDto(r, r.authorFullName ?? ''));
  }

  async requestSecurityCheck(supplierId: string, actor: Actor): Promise<SupplierSecurityCheck> {
    return this.db.transaction(async (tx) => {
      const [sup] = await tx
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .where(eq(suppliers.id, supplierId))
        .limit(1);
      if (!sup) throw new NotFoundError('Supplier', supplierId);

      const [lastEvent] = await tx
        .select({ eventType: supplierSecurityChecks.eventType })
        .from(supplierSecurityChecks)
        .where(eq(supplierSecurityChecks.supplierId, supplierId))
        .orderBy(desc(supplierSecurityChecks.createdAt))
        .limit(1);
      if (lastEvent?.eventType === 'requested') {
        throw new ConflictError('Поставщик уже на проверке');
      }

      const [created] = await tx
        .insert(supplierSecurityChecks)
        .values({ supplierId, authorId: actor.id, eventType: 'requested', comment: null })
        .returning();

      const sbUsers = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'security'), eq(users.isActive, true)));
      if (sbUsers.length > 0) {
        await tx.insert(notifications).values(
          sbUsers.map((u) => ({
            type: 'sb_review_requested',
            title: 'Новый запрос на проверку поставщика',
            message: `${actor.fullName} отправил поставщика «${sup.name}» на проверку СБ`,
            userId: u.id,
            supplierId,
          })),
        );
      }

      return checkToDto(created!, actor.fullName);
    });
  }

  async decideSecurityCheck(
    supplierId: string,
    actor: Actor,
    body: SupplierSecurityDecisionBody,
  ): Promise<SupplierSecurityCheck> {
    const { decision, comment } = body;
    if (decision === 'rejected' && (!comment || comment.trim().length < 3)) {
      throw new ValidationError('Комментарий обязателен при отклонении (минимум 3 символа)');
    }

    return this.db.transaction(async (tx) => {
      const [sup] = await tx
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .where(eq(suppliers.id, supplierId))
        .limit(1);
      if (!sup) throw new NotFoundError('Supplier', supplierId);

      const [lastDecision] = await tx
        .select({ createdAt: supplierSecurityChecks.createdAt })
        .from(supplierSecurityChecks)
        .where(
          and(
            eq(supplierSecurityChecks.supplierId, supplierId),
            inArray(supplierSecurityChecks.eventType, ['approved', 'rejected']),
          ),
        )
        .orderBy(desc(supplierSecurityChecks.createdAt))
        .limit(1);

      const openRequests = await tx
        .select({ authorId: supplierSecurityChecks.authorId })
        .from(supplierSecurityChecks)
        .where(
          and(
            eq(supplierSecurityChecks.supplierId, supplierId),
            eq(supplierSecurityChecks.eventType, 'requested'),
            ...(lastDecision?.createdAt
              ? [gt(supplierSecurityChecks.createdAt, lastDecision.createdAt)]
              : []),
          ),
        );

      const [created] = await tx
        .insert(supplierSecurityChecks)
        .values({
          supplierId,
          authorId: actor.id,
          eventType: decision,
          comment: comment?.trim() || null,
        })
        .returning();

      await tx
        .update(suppliers)
        .set({ lastSecurityStatus: decision })
        .where(eq(suppliers.id, supplierId));

      const initiatorIds = Array.from(new Set(openRequests.map((r) => r.authorId))).filter(
        (uid) => uid !== actor.id,
      );
      if (initiatorIds.length > 0) {
        const decisionLabel = decision === 'approved' ? 'согласован' : 'отклонён';
        await tx.insert(notifications).values(
          initiatorIds.map((uid) => ({
            type: 'sb_review_decided',
            title: 'Решение по проверке поставщика',
            message: `Поставщик «${sup.name}» ${decisionLabel} отделом СБ`,
            userId: uid,
            supplierId,
          })),
        );
      }

      return checkToDto(created!, actor.fullName);
    });
  }
}
