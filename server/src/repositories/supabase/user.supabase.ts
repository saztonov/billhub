/**
 * SupabaseRepository для домена «Пользователь».
 *
 * В Iteration 6 интерфейс расширится методами для standalone auth (password_hash,
 * refresh tokens). Сейчас (Iteration 3) — только базовый CRUD.
 *
 * Пользователи живут в `public.users`; учётные записи Supabase Auth (`auth.users`)
 * используются для логина и не управляются через этот репозиторий.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRepository } from '../user.repository.js';
import type { User, CreateUserBody, UpdateUserBody, ListUsersQuery } from '../../schemas/user.js';
import { NotFoundError, UniqueConstraintError, type PaginatedResult } from '../types.js';

const SELECT_FIELDS =
  'id, email, role, created_at, counterparty_id, department_id, all_sites, full_name, is_active';

type UserRow = {
  id: string;
  email: string;
  role: string;
  created_at: string;
  counterparty_id: string | null;
  department_id: string | null;
  all_sites: boolean;
  full_name: string;
  is_active: boolean;
};

function rowToDto(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role as User['role'],
    counterpartyId: row.counterparty_id,
    /**
     * Внимание: department_id в БД — UUID department-справочника, а в DTO `department`
     * используется enum (omts/shtab/smetny). Конвертация делается в роуте через JOIN.
     * Для типовой совместимости здесь возвращаем null и помечаем как известное упрощение,
     * пока department lookup не интегрирован в репозиторий (Iteration 4 — Drizzle с relations).
     */
    department: null,
    allSites: row.all_sites,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export class SupabaseUserRepository implements UserRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getById(id: string): Promise<User> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError('User', id);
    return found;
  }

  async findById(id: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select(SELECT_FIELDS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToDto(data as UserRow) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select(SELECT_FIELDS)
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToDto(data as UserRow) : null;
  }

  async list(query: ListUsersQuery): Promise<PaginatedResult<User>> {
    let q = this.supabase.from('users').select(SELECT_FIELDS, { count: 'exact' });
    if (query.role) q = q.eq('role', query.role);
    if (query.counterpartyId) q = q.eq('counterparty_id', query.counterpartyId);
    if (query.isActive !== undefined) q = q.eq('is_active', query.isActive);
    if (query.search) {
      const term = `%${query.search}%`;
      q = q.or(`email.ilike.${term},full_name.ilike.${term}`);
    }

    const from = (query.page - 1) * query.pageSize;
    const to = from + query.pageSize - 1;
    q = q.range(from, to).order('created_at', { ascending: false });

    const { data, error, count } = await q;
    if (error) throw error;

    return {
      items: (data ?? []).map((row) => rowToDto(row as UserRow)),
      totalCount: count ?? 0,
    };
  }

  async create(body: CreateUserBody): Promise<User> {
    // ВАЖНО: в текущей архитектуре создание пользователя — это две операции:
    // 1) создание учётной записи в auth.users (Supabase Auth Admin API), 2) запись профиля в public.users.
    // SupabaseUserRepository отвечает только за вторую часть. Полная процедура управления паролями
    // вводится в Iteration 6 (standalone auth).
    const { data, error } = await this.supabase
      .from('users')
      .insert({
        email: body.email,
        full_name: body.fullName,
        role: body.role,
        counterparty_id: body.counterpartyId ?? null,
        all_sites: body.allSites ?? false,
        is_active: body.isActive ?? true,
      })
      .select(SELECT_FIELDS)
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new UniqueConstraintError('User', 'email', body.email);
      }
      throw error;
    }
    return rowToDto(data as UserRow);
  }

  async update(id: string, body: UpdateUserBody): Promise<User> {
    const patch: Record<string, unknown> = {};
    if (body.email !== undefined) patch.email = body.email;
    if (body.fullName !== undefined) patch.full_name = body.fullName;
    if (body.role !== undefined) patch.role = body.role;
    if (body.counterpartyId !== undefined) patch.counterparty_id = body.counterpartyId;
    if (body.allSites !== undefined) patch.all_sites = body.allSites;
    if (body.isActive !== undefined) patch.is_active = body.isActive;

    const { data, error } = await this.supabase
      .from('users')
      .update(patch)
      .eq('id', id)
      .select(SELECT_FIELDS)
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505' && body.email) {
        throw new UniqueConstraintError('User', 'email', body.email);
      }
      if ((error as { code?: string }).code === 'PGRST116') {
        throw new NotFoundError('User', id);
      }
      throw error;
    }
    return rowToDto(data as UserRow);
  }

  async delete(id: string): Promise<void> {
    // .select('id') возвращает удалённые строки — пусто означает «не найдено» (контракт ⇒ NotFoundError).
    const { data, error } = await this.supabase.from('users').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new NotFoundError('User', id);
  }

  async setActive(id: string, isActive: boolean): Promise<User> {
    return this.update(id, { isActive });
  }
}
