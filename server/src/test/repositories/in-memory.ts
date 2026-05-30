/**
 * In-memory реализации Repository-интерфейсов для unit-тестов бизнес-логики.
 * Эти реализации НЕ используются в runtime — только в тестах сервисов и роутов,
 * чтобы не поднимать реальный Supabase/Drizzle.
 */
import type { CounterpartyRepository } from '../../repositories/counterparty.repository.js';
import type {
  SupplierRepository,
  SupplierApiListQuery,
  Actor,
} from '../../repositories/supplier.repository.js';
import type { UserRepository } from '../../repositories/user.repository.js';
import {
  NotFoundError,
  UniqueConstraintError,
  ConflictError,
  ValidationError,
  type PaginatedResult,
} from '../../repositories/types.js';
import type {
  Counterparty,
  CreateCounterpartyBody,
  UpdateCounterpartyBody,
  ListCounterpartiesQuery,
} from '../../schemas/counterparty.js';
import type {
  Supplier,
  CreateSupplierBody,
  UpdateSupplierBody,
  ListSuppliersQuery,
  SupplierListItem,
  SupplierSecurityCheck,
  SupplierSecurityDecisionBody,
} from '../../schemas/supplier.js';
import type { User, CreateUserBody, UpdateUserBody, ListUsersQuery } from '../../schemas/user.js';

function makeId(): string {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class InMemoryCounterpartyRepository implements CounterpartyRepository {
  private items: Counterparty[] = [];

  reset(): void {
    this.items = [];
  }

  seed(items: Counterparty[]): void {
    this.items = [...items];
  }

  async getById(id: string): Promise<Counterparty> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError('Counterparty', id);
    return found;
  }

  async findById(id: string): Promise<Counterparty | null> {
    return this.items.find((c) => c.id === id) ?? null;
  }

  async findByInn(inn: string): Promise<Counterparty | null> {
    return this.items.find((c) => c.inn === inn) ?? null;
  }

  async list(query: ListCounterpartiesQuery): Promise<PaginatedResult<Counterparty>> {
    let filtered = this.items;
    if (query.search) {
      const term = query.search.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.inn.includes(query.search ?? '') ||
          c.alternativeNames.some((alt) => alt.toLowerCase().includes(term)),
      );
    }
    if (query.onlyCounterpartyId) {
      filtered = filtered.filter((c) => c.id === query.onlyCounterpartyId);
    }
    if (query.sbFilter === 'pending') {
      filtered = filtered.filter((c) => c.hasPendingRequest === true);
    }
    const totalCount = filtered.length;
    const from = (query.page - 1) * query.pageSize;
    const items = filtered.slice(from, from + query.pageSize);
    return { items, totalCount };
  }

  async create(body: CreateCounterpartyBody): Promise<Counterparty> {
    if (this.items.some((c) => c.inn === body.inn)) {
      throw new UniqueConstraintError('Counterparty', 'inn', body.inn);
    }
    const created: Counterparty = {
      id: makeId(),
      name: body.name,
      inn: body.inn,
      address: body.address ?? '',
      alternativeNames: body.alternativeNames ?? [],
      registrationToken: null,
      createdAt: nowIso(),
    };
    this.items.push(created);
    return created;
  }

  async update(id: string, body: UpdateCounterpartyBody): Promise<Counterparty> {
    const idx = this.items.findIndex((c) => c.id === id);
    if (idx === -1) throw new NotFoundError('Counterparty', id);
    if (body.inn && this.items.some((c) => c.id !== id && c.inn === body.inn)) {
      throw new UniqueConstraintError('Counterparty', 'inn', body.inn);
    }
    const updated: Counterparty = { ...this.items[idx]! };
    if (body.name !== undefined) updated.name = body.name;
    if (body.inn !== undefined) updated.inn = body.inn;
    if (body.address !== undefined) updated.address = body.address;
    if (body.alternativeNames !== undefined) updated.alternativeNames = body.alternativeNames;
    this.items[idx] = updated;
    return updated;
  }

  async delete(id: string): Promise<void> {
    const idx = this.items.findIndex((c) => c.id === id);
    if (idx === -1) throw new NotFoundError('Counterparty', id);
    this.items.splice(idx, 1);
  }

  async listAll(): Promise<Counterparty[]> {
    return [...this.items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async batchCreate(rows: { name: string; inn: string }[]): Promise<number> {
    for (const r of rows) {
      this.items.push({
        id: makeId(),
        name: r.name,
        inn: r.inn,
        address: '',
        alternativeNames: [],
        registrationToken: null,
        createdAt: nowIso(),
      });
    }
    return rows.length;
  }
}

export class InMemorySupplierRepository implements SupplierRepository {
  private items: Supplier[] = [];
  private checks: SupplierSecurityCheck[] = [];

  reset(): void {
    this.items = [];
    this.checks = [];
  }

  seed(items: Supplier[]): void {
    this.items = [...items];
  }

  async getById(id: string): Promise<Supplier> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError('Supplier', id);
    return found;
  }

  async findById(id: string): Promise<Supplier | null> {
    return this.items.find((s) => s.id === id) ?? null;
  }

  async findByInn(inn: string): Promise<Supplier | null> {
    return this.items.find((s) => s.inn === inn) ?? null;
  }

  async list(query: ListSuppliersQuery): Promise<PaginatedResult<Supplier>> {
    let filtered = this.items;
    if (query.search) {
      const term = query.search.toLowerCase();
      filtered = filtered.filter(
        (s) => s.name.toLowerCase().includes(term) || s.inn.includes(query.search ?? ''),
      );
    }
    if (query.onlySupplierId) {
      filtered = filtered.filter((s) => s.id === query.onlySupplierId);
    }
    if (query.sbFilter === 'pending') {
      filtered = filtered.filter((s) => s.hasPendingRequest === true);
    }
    const totalCount = filtered.length;
    const from = (query.page - 1) * query.pageSize;
    return { items: filtered.slice(from, from + query.pageSize), totalCount };
  }

  async create(body: CreateSupplierBody): Promise<Supplier> {
    if (this.items.some((s) => s.inn === body.inn)) {
      throw new UniqueConstraintError('Supplier', 'inn', body.inn);
    }
    const created: Supplier = {
      id: makeId(),
      name: body.name,
      inn: body.inn,
      alternativeNames: body.alternativeNames ?? [],
      createdAt: nowIso(),
      foundingDocumentsComment: null,
      lastSecurityStatus: null,
    };
    this.items.push(created);
    return created;
  }

  async update(id: string, body: UpdateSupplierBody): Promise<Supplier> {
    const idx = this.items.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundError('Supplier', id);
    if (body.inn && this.items.some((s) => s.id !== id && s.inn === body.inn)) {
      throw new UniqueConstraintError('Supplier', 'inn', body.inn);
    }
    const updated: Supplier = { ...this.items[idx]! };
    if (body.name !== undefined) updated.name = body.name;
    if (body.inn !== undefined) updated.inn = body.inn;
    if (body.alternativeNames !== undefined) updated.alternativeNames = body.alternativeNames;
    if (body.foundingDocumentsComment !== undefined) {
      updated.foundingDocumentsComment = body.foundingDocumentsComment;
    }
    this.items[idx] = updated;
    return updated;
  }

  async delete(id: string): Promise<void> {
    const idx = this.items.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundError('Supplier', id);
    this.items.splice(idx, 1);
  }

  async listAll(): Promise<Supplier[]> {
    return [...this.items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async batchCreate(rows: { name: string; inn: string }[]): Promise<number> {
    for (const r of rows) {
      this.items.push({
        id: makeId(),
        name: r.name,
        inn: r.inn,
        alternativeNames: [],
        createdAt: nowIso(),
        foundingDocumentsComment: null,
        lastSecurityStatus: null,
      });
    }
    return rows.length;
  }

  async listForApi(
    query: SupplierApiListQuery,
  ): Promise<{ items: SupplierListItem[]; total: number }> {
    let filtered = this.items;
    if (query.search) {
      const term = query.search.toLowerCase();
      filtered = filtered.filter(
        (s) => s.name.toLowerCase().includes(term) || s.inn.includes(query.search ?? ''),
      );
    }
    if (query.sbFilter === 'pending') {
      filtered = filtered.filter((s) => s.hasPendingRequest === true);
    }
    const total = filtered.length;
    const from = (query.page - 1) * query.pageSize;
    const items: SupplierListItem[] = filtered.slice(from, from + query.pageSize).map((s) => ({
      id: s.id,
      name: s.name,
      inn: s.inn,
      alternativeNames: s.alternativeNames,
      createdAt: s.createdAt,
      lastSecurityCheck: s.lastSecurityStatus
        ? { status: s.lastSecurityStatus, createdAt: s.createdAt }
        : null,
      hasPendingRequest: s.hasPendingRequest ?? false,
    }));
    return { items, total };
  }

  async getSecurityHistory(supplierId: string): Promise<SupplierSecurityCheck[]> {
    return this.checks
      .filter((c) => c.supplierId === supplierId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async requestSecurityCheck(supplierId: string, actor: Actor): Promise<SupplierSecurityCheck> {
    const sup = this.items.find((s) => s.id === supplierId);
    if (!sup) throw new NotFoundError('Supplier', supplierId);
    const last = this.checks
      .filter((c) => c.supplierId === supplierId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    if (last?.eventType === 'requested') {
      throw new ConflictError('Поставщик уже на проверке');
    }
    const created: SupplierSecurityCheck = {
      id: makeId(),
      supplierId,
      authorId: actor.id,
      authorFullName: actor.fullName,
      eventType: 'requested',
      comment: null,
      createdAt: nowIso(),
    };
    this.checks.push(created);
    return created;
  }

  async decideSecurityCheck(
    supplierId: string,
    actor: Actor,
    body: SupplierSecurityDecisionBody,
  ): Promise<SupplierSecurityCheck> {
    if (body.decision === 'rejected' && (!body.comment || body.comment.trim().length < 3)) {
      throw new ValidationError('Комментарий обязателен при отклонении (минимум 3 символа)');
    }
    const sup = this.items.find((s) => s.id === supplierId);
    if (!sup) throw new NotFoundError('Supplier', supplierId);
    const created: SupplierSecurityCheck = {
      id: makeId(),
      supplierId,
      authorId: actor.id,
      authorFullName: actor.fullName,
      eventType: body.decision,
      comment: body.comment?.trim() || null,
      createdAt: nowIso(),
    };
    this.checks.push(created);
    sup.lastSecurityStatus = body.decision;
    return created;
  }
}

export class InMemoryUserRepository implements UserRepository {
  private items: User[] = [];

  reset(): void {
    this.items = [];
  }

  seed(items: User[]): void {
    this.items = [...items];
  }

  async getById(id: string): Promise<User> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError('User', id);
    return found;
  }

  async findById(id: string): Promise<User | null> {
    return this.items.find((u) => u.id === id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.items.find((u) => u.email === email) ?? null;
  }

  async list(query: ListUsersQuery): Promise<PaginatedResult<User>> {
    let filtered = this.items;
    if (query.role) filtered = filtered.filter((u) => u.role === query.role);
    if (query.counterpartyId)
      filtered = filtered.filter((u) => u.counterpartyId === query.counterpartyId);
    if (query.isActive !== undefined)
      filtered = filtered.filter((u) => u.isActive === query.isActive);
    if (query.search) {
      const term = query.search.toLowerCase();
      filtered = filtered.filter(
        (u) => u.email.toLowerCase().includes(term) || u.fullName.toLowerCase().includes(term),
      );
    }
    const totalCount = filtered.length;
    const from = (query.page - 1) * query.pageSize;
    return { items: filtered.slice(from, from + query.pageSize), totalCount };
  }

  async create(body: CreateUserBody): Promise<User> {
    if (this.items.some((u) => u.email === body.email)) {
      throw new UniqueConstraintError('User', 'email', body.email);
    }
    const created: User = {
      id: makeId(),
      email: body.email,
      fullName: body.fullName,
      role: body.role,
      counterpartyId: body.counterpartyId ?? null,
      department: body.department ?? null,
      allSites: body.allSites ?? false,
      isActive: body.isActive ?? true,
      createdAt: nowIso(),
    };
    this.items.push(created);
    return created;
  }

  async update(id: string, body: UpdateUserBody): Promise<User> {
    const idx = this.items.findIndex((u) => u.id === id);
    if (idx === -1) throw new NotFoundError('User', id);
    if (body.email && this.items.some((u) => u.id !== id && u.email === body.email)) {
      throw new UniqueConstraintError('User', 'email', body.email);
    }
    const updated: User = { ...this.items[idx]! };
    if (body.email !== undefined) updated.email = body.email;
    if (body.fullName !== undefined) updated.fullName = body.fullName;
    if (body.role !== undefined) updated.role = body.role;
    if (body.counterpartyId !== undefined) updated.counterpartyId = body.counterpartyId;
    if (body.department !== undefined) updated.department = body.department;
    if (body.allSites !== undefined) updated.allSites = body.allSites;
    if (body.isActive !== undefined) updated.isActive = body.isActive;
    this.items[idx] = updated;
    return updated;
  }

  async delete(id: string): Promise<void> {
    const idx = this.items.findIndex((u) => u.id === id);
    if (idx === -1) throw new NotFoundError('User', id);
    this.items.splice(idx, 1);
  }

  async setActive(id: string, isActive: boolean): Promise<User> {
    return this.update(id, { isActive });
  }
}
