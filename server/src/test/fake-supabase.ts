/**
 * Лёгкий in-memory фейк Supabase-клиента для unit-тестов Supabase-адаптеров и equivalence-тестов.
 *
 * Поддерживает подмножество API, используемое репозиториями:
 *   from(table).select(fields,{count}).eq().or().range().order().maybeSingle()/single()
 *   from(table).insert(obj).select().single()
 *   from(table).update(obj).eq().select().single()
 *   from(table).delete().eq()
 *   rpc(name, params)
 * и эмулирует коды ошибок PostgreSQL/PostgREST (23505, 23503, PGRST116).
 *
 * Это тестовый дубль: уникальные ограничения и FK-нарушения конфигурируются явно,
 * чтобы проверить ветки трансляции ошибок в адаптерах.
 */
import { randomUUID } from 'node:crypto';

export type Row = Record<string, unknown>;
interface QueryResult {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number | null;
}

type DefaultsFn = (row: Row) => Row;

const DEFAULTS: Record<string, DefaultsFn> = {
  counterparties: (row) => ({
    id: randomUUID(),
    created_at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    registration_token: randomUUID(),
    address: '',
    alternative_names: [],
    ...row,
  }),
  suppliers: (row) => ({
    id: randomUUID(),
    created_at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    alternative_names: [],
    founding_documents_comment: null,
    last_security_status: null,
    department_id: null,
    ...row,
  }),
  users: (row) => ({
    id: randomUUID(),
    created_at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    counterparty_id: null,
    department_id: null,
    ...row,
  }),
};

function ilikeMatch(value: unknown, pattern: string): boolean {
  const needle = pattern.replace(/%/g, '').toLowerCase();
  return String(value ?? '')
    .toLowerCase()
    .includes(needle);
}

class FakeBuilder implements PromiseLike<QueryResult> {
  private filters: { col: string; op: 'eq' | 'neq' | 'in' | 'gt'; val: unknown }[] = [];
  private orExpr: string | null = null;
  private rangeBounds: [number, number] | null = null;
  private orderSpec: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private singleMode = false;
  private maybeMode = false;
  private wantCount = false;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
    private readonly op: 'select' | 'insert' | 'update' | 'delete',
    private readonly payload?: Row | Row[],
  ) {}

  select(_fields?: string, opts?: { count?: string }): this {
    if (opts?.count) this.wantCount = true;
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push({ col, op: 'eq', val });
    return this;
  }
  neq(col: string, val: unknown): this {
    this.filters.push({ col, op: 'neq', val });
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.filters.push({ col, op: 'in', val: vals });
    return this;
  }
  gt(col: string, val: unknown): this {
    this.filters.push({ col, op: 'gt', val });
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  or(expr: string): this {
    this.orExpr = expr;
    return this;
  }
  range(from: number, to: number): this {
    this.rangeBounds = [from, to];
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderSpec = { col, asc: opts?.ascending !== false };
    return this;
  }
  maybeSingle(): this {
    this.maybeMode = true;
    return this;
  }
  single(): this {
    this.singleMode = true;
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }

  private matchFilter(
    r: Row,
    f: { col: string; op: 'eq' | 'neq' | 'in' | 'gt'; val: unknown },
  ): boolean {
    if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(r[f.col]);
    if (f.op === 'gt') return String(r[f.col] ?? '') > String(f.val ?? '');
    if (f.op === 'neq') return r[f.col] !== f.val;
    return r[f.col] === f.val;
  }

  private applyFilters(rows: Row[]): Row[] {
    let result = rows.filter((r) => this.filters.every((f) => this.matchFilter(r, f)));
    if (this.orExpr) {
      const parts = this.orExpr.split(',').map((p) => p.trim());
      result = result.filter((r) =>
        parts.some((p) => {
          const [col, fn, ...rest] = p.split('.');
          const pattern = rest.join('.');
          return fn === 'ilike' && col ? ilikeMatch(r[col], pattern) : false;
        }),
      );
    }
    return result;
  }

  private exec(): QueryResult {
    const store = this.db.tableRows(this.table);

    if (this.op === 'select') {
      let rows = this.applyFilters(store);
      const total = rows.length;
      if (this.orderSpec) {
        const { col, asc } = this.orderSpec;
        rows = [...rows].sort((a, b) => {
          const av = String(a[col] ?? '');
          const bv = String(b[col] ?? '');
          return asc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (this.rangeBounds) rows = rows.slice(this.rangeBounds[0], this.rangeBounds[1] + 1);
      if (this.limitN !== null) rows = rows.slice(0, this.limitN);
      if (this.maybeMode) return { data: rows[0] ?? null, error: null };
      if (this.singleMode) {
        return rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      }
      return { data: rows, error: null, count: this.wantCount ? total : null };
    }

    if (this.op === 'insert') {
      const defaults = DEFAULTS[this.table] ?? ((r: Row) => ({ id: randomUUID(), ...r }));
      const inputs: Row[] = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const inserted: Row[] = [];
      for (const inp of inputs) {
        const row = defaults(inp);
        const dup = this.db.findUniqueViolation(this.table, row, null);
        if (dup) return { data: null, error: { code: '23505', message: 'unique violation' } };
        store.push(row);
        inserted.push(row);
      }
      return this.singleMode
        ? { data: inserted[0] ?? null, error: null }
        : { data: inserted, error: null };
    }

    if (this.op === 'update') {
      const matched = this.applyFilters(store);
      if (matched.length === 0) {
        return this.singleMode
          ? { data: null, error: { code: 'PGRST116', message: 'no rows' } }
          : { data: [], error: null };
      }
      const patch = Array.isArray(this.payload) ? {} : (this.payload ?? {});
      // unique-проверка по первой совпавшей строке (мульти-row update не меняет unique-поля)
      const candidate = { ...matched[0]!, ...patch };
      const dup = this.db.findUniqueViolation(this.table, candidate, matched[0]!);
      if (dup) return { data: null, error: { code: '23505', message: 'unique violation' } };
      // real Supabase обновляет ВСЕ совпавшие строки
      for (const row of matched) Object.assign(row, patch);
      return this.singleMode ? { data: matched[0], error: null } : { data: matched, error: null };
    }

    // delete: .select() возвращает удалённые строки (как PostgREST). Пусто = не найдено.
    if (this.db.fkViolations.has(this.table)) {
      return { data: null, error: { code: '23503', message: 'foreign key violation' } };
    }
    const matched = this.applyFilters(store);
    for (const r of matched) {
      const idx = store.indexOf(r);
      if (idx >= 0) store.splice(idx, 1);
    }
    return { data: matched, error: null };
  }
}

export class FakeSupabase {
  private rows = new Map<string, Row[]>();
  private uniques = new Map<string, string[][]>();
  private rpcResults = new Map<string, unknown>();
  readonly fkViolations = new Set<string>();

  constructor() {
    this.setUnique('counterparties', [['inn'], ['registration_token']]);
    this.setUnique('suppliers', [['inn']]);
  }

  tableRows(table: string): Row[] {
    if (!this.rows.has(table)) this.rows.set(table, []);
    return this.rows.get(table)!;
  }

  setUnique(table: string, groups: string[][]): void {
    this.uniques.set(table, groups);
  }

  seed(table: string, rows: Row[]): void {
    this.rows.set(
      table,
      rows.map((r) => ({ ...r })),
    );
  }

  setRpcResult(name: string, data: unknown): void {
    this.rpcResults.set(name, data);
  }

  setFkViolation(table: string): void {
    this.fkViolations.add(table);
  }

  findUniqueViolation(table: string, candidate: Row, exclude: Row | null): Row | null {
    const groups = this.uniques.get(table) ?? [];
    const rows = this.tableRows(table);
    for (const cols of groups) {
      for (const r of rows) {
        if (r === exclude) continue;
        if (cols.every((c) => r[c] === candidate[c] && candidate[c] !== undefined)) return r;
      }
    }
    return null;
  }

  from(table: string) {
    return {
      select: (fields?: string, opts?: { count?: string }) =>
        new FakeBuilder(this, table, 'select').select(fields, opts),
      insert: (payload: Row | Row[]) => new FakeBuilder(this, table, 'insert', payload),
      update: (payload: Row) => new FakeBuilder(this, table, 'update', payload),
      delete: () => new FakeBuilder(this, table, 'delete'),
    };
  }

  rpc(name: string, _params?: Record<string, unknown>): PromiseLike<QueryResult> {
    return Promise.resolve({ data: this.rpcResults.get(name) ?? [], error: null });
  }
}
