/**
 * DrizzleRepository для домена «Поставщик» (Iteration 4).
 * list() вызывает SQL-функцию list_suppliers_with_sb через db.execute.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { suppliers } from '../../db/schema/index.js';
import type { SupplierRepository } from '../supplier.repository.js';
import type {
  Supplier,
  CreateSupplierBody,
  UpdateSupplierBody,
  ListSuppliersQuery,
} from '../../schemas/supplier.js';
import {
  NotFoundError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
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
}
