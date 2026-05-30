/**
 * DrizzleRepository для домена «Контрагент» (Iteration 4).
 *
 * Параллельная Supabase-реализации (Strangler Fig). Выбирается через DB_PROVIDER=drizzle.
 * Конвертация snake_case → camelCase: Drizzle отдаёт camelCase ключи (схема использует
 * явные имена колонок), поэтому маппинг тривиален. list() вызывает SQL-функцию
 * list_counterparties_with_sb через db.execute (RPC-эквивалент, ADR-0002).
 */
import { desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { counterparties } from '../../db/schema/index.js';
import type { CounterpartyRepository } from '../counterparty.repository.js';
import type {
  Counterparty,
  CreateCounterpartyBody,
  UpdateCounterpartyBody,
  ListCounterpartiesQuery,
} from '../../schemas/counterparty.js';
import {
  NotFoundError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  type PaginatedResult,
} from '../types.js';
import { getPgErrorCode, PG_UNIQUE_VIOLATION, PG_FOREIGN_KEY_VIOLATION } from './errors.js';

type Db = PostgresJsDatabase<typeof schema>;
type Row = typeof counterparties.$inferSelect;

function rowToDto(row: Row): Counterparty {
  return {
    id: row.id,
    name: row.name,
    inn: row.inn,
    address: row.address ?? '',
    alternativeNames: row.alternativeNames ?? [],
    registrationToken: row.registrationToken,
    createdAt: row.createdAt,
  };
}

/** Строка, возвращаемая SQL-функцией list_counterparties_with_sb. */
interface SbRow {
  id: string;
  name: string;
  inn: string;
  address: string | null;
  alternative_names: string[] | null;
  registration_token: string | null;
  created_at: string;
  last_security_status: 'approved' | 'rejected' | null;
  has_pending_request: boolean;
  total_count: number | string;
}

export class DrizzleCounterpartyRepository implements CounterpartyRepository {
  constructor(private readonly db: Db) {}

  async getById(id: string): Promise<Counterparty> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError('Counterparty', id);
    return found;
  }

  async findById(id: string): Promise<Counterparty | null> {
    const [row] = await this.db
      .select()
      .from(counterparties)
      .where(eq(counterparties.id, id))
      .limit(1);
    return row ? rowToDto(row) : null;
  }

  async findByInn(inn: string): Promise<Counterparty | null> {
    const [row] = await this.db
      .select()
      .from(counterparties)
      .where(eq(counterparties.inn, inn))
      .limit(1);
    return row ? rowToDto(row) : null;
  }

  async list(query: ListCounterpartiesQuery): Promise<PaginatedResult<Counterparty>> {
    const rows = (await this.db.execute(
      sql`SELECT * FROM list_counterparties_with_sb(
        ${query.search ?? null},
        ${query.sbFilter},
        ${query.page},
        ${query.pageSize},
        ${query.cutoffDate ?? null},
        ${query.onlyCounterpartyId ?? null}
      )`,
    )) as unknown as SbRow[];

    if (rows.length === 0 || !rows[0]) return { items: [], totalCount: 0 };

    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        inn: r.inn,
        address: r.address ?? '',
        alternativeNames: r.alternative_names ?? [],
        registrationToken: r.registration_token,
        createdAt: r.created_at,
        lastSecurityStatus: r.last_security_status,
        hasPendingRequest: r.has_pending_request,
      })),
      totalCount: Number(rows[0].total_count),
    };
  }

  async create(body: CreateCounterpartyBody): Promise<Counterparty> {
    try {
      const [row] = await this.db
        .insert(counterparties)
        .values({
          name: body.name,
          inn: body.inn,
          address: body.address ?? '',
          alternativeNames: body.alternativeNames ?? [],
        })
        .returning();
      return rowToDto(row!);
    } catch (err) {
      if (getPgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        throw new UniqueConstraintError('Counterparty', 'inn', body.inn);
      }
      throw err;
    }
  }

  async update(id: string, body: UpdateCounterpartyBody): Promise<Counterparty> {
    const patch: Partial<typeof counterparties.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.inn !== undefined) patch.inn = body.inn;
    if (body.address !== undefined) patch.address = body.address;
    if (body.alternativeNames !== undefined) patch.alternativeNames = body.alternativeNames;

    if (Object.keys(patch).length === 0) return this.getById(id);

    try {
      const [row] = await this.db
        .update(counterparties)
        .set(patch)
        .where(eq(counterparties.id, id))
        .returning();
      if (!row) throw new NotFoundError('Counterparty', id);
      return rowToDto(row);
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      if (getPgErrorCode(err) === PG_UNIQUE_VIOLATION && body.inn) {
        throw new UniqueConstraintError('Counterparty', 'inn', body.inn);
      }
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const deleted = await this.db
        .delete(counterparties)
        .where(eq(counterparties.id, id))
        .returning({ id: counterparties.id });
      if (deleted.length === 0) throw new NotFoundError('Counterparty', id);
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      if (getPgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION) {
        throw new ForeignKeyConstraintError('Counterparty', 'связанные заявки/файлы');
      }
      throw err;
    }
  }

  async listAll(): Promise<Counterparty[]> {
    const rows = await this.db
      .select()
      .from(counterparties)
      .orderBy(desc(counterparties.createdAt));
    return rows.map(rowToDto);
  }

  async batchCreate(rows: { name: string; inn: string }[]): Promise<number> {
    if (rows.length === 0) return 0;
    return this.db.transaction(async (tx) => {
      await tx
        .insert(counterparties)
        .values(rows.map((r) => ({ name: r.name, inn: r.inn, address: '', alternativeNames: [] })));
      return rows.length;
    });
  }
}
