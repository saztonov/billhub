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
  ValidationError,
  type PaginatedResult,
} from '../types.js';

const DETAIL_FIELDS =
  'id, email, full_name, role, counterparty_id, department_id, all_sites, is_active, created_at';

interface DetailRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  counterparty_id: string | null;
  department_id: string | null;
  all_sites: boolean;
  is_active: boolean;
  created_at: string;
}

function uniq(ids: (string | null)[]): string[] {
  return Array.from(new Set(ids.filter((x): x is string => !!x)));
}

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

  private detailToDto(
    row: DetailRow,
    cpName: Map<string, string>,
    siteIds: string[],
    siteNames: string[],
  ): UserDetail {
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      counterpartyId: row.counterparty_id,
      counterpartyName: row.counterparty_id ? (cpName.get(row.counterparty_id) ?? null) : null,
      department: row.department_id,
      allSites: row.all_sites,
      isActive: row.is_active,
      siteIds,
      siteNames,
      createdAt: row.created_at,
    };
  }

  /** Загружает карты имён контрагентов и объектов для набора пользователей. */
  private async loadDetailMaps(
    cpIds: string[],
    siteIds: string[],
  ): Promise<{ cpName: Map<string, string>; siteName: Map<string, string> }> {
    const [cps, sites] = await Promise.all([
      cpIds.length
        ? this.supabase.from('counterparties').select('id, name').in('id', cpIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      siteIds.length
        ? this.supabase.from('construction_sites').select('id, name').in('id', siteIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);
    return {
      cpName: new Map(
        ((cps.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
      ),
      siteName: new Map(
        ((sites.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
      ),
    };
  }

  async listWithDetails(): Promise<UserDetail[]> {
    const { data, error } = await this.supabase
      .from('users')
      .select(DETAIL_FIELDS)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as DetailRow[];
    if (rows.length === 0) return [];

    const { data: mappings, error: mErr } = await this.supabase
      .from('user_construction_sites_mapping')
      .select('user_id, construction_site_id');
    if (mErr) throw mErr;
    const mapRows = (mappings ?? []) as { user_id: string; construction_site_id: string }[];

    const byUser = new Map<string, string[]>();
    for (const m of mapRows) {
      if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
      byUser.get(m.user_id)!.push(m.construction_site_id);
    }

    const maps = await this.loadDetailMaps(
      uniq(rows.map((r) => r.counterparty_id)),
      uniq(mapRows.map((m) => m.construction_site_id)),
    );

    return rows.map((row) => {
      const ids = byUser.get(row.id) ?? [];
      return this.detailToDto(
        row,
        maps.cpName,
        ids,
        ids.map((id) => maps.siteName.get(id) ?? ''),
      );
    });
  }

  async getWithDetails(id: string): Promise<UserDetail> {
    const { data, error } = await this.supabase
      .from('users')
      .select(DETAIL_FIELDS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundError('User', id);
    const row = data as DetailRow;

    const { data: mappings } = await this.supabase
      .from('user_construction_sites_mapping')
      .select('construction_site_id')
      .eq('user_id', id);
    const ids = ((mappings ?? []) as { construction_site_id: string }[]).map(
      (m) => m.construction_site_id,
    );

    const maps = await this.loadDetailMaps(row.counterparty_id ? [row.counterparty_id] : [], ids);
    return this.detailToDto(
      row,
      maps.cpName,
      ids,
      ids.map((sid) => maps.siteName.get(sid) ?? ''),
    );
  }

  async getSiteAccess(id: string): Promise<{ allSites: boolean; siteIds: string[] }> {
    const { data, error } = await this.supabase
      .from('users')
      .select('all_sites')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundError('User', id);
    const { data: mappings } = await this.supabase
      .from('user_construction_sites_mapping')
      .select('construction_site_id')
      .eq('user_id', id);
    const siteIds = ((mappings ?? []) as { construction_site_id: string }[]).map(
      (m) => m.construction_site_id,
    );
    return { allSites: (data as { all_sites: boolean }).all_sites ?? false, siteIds };
  }

  async getSiteMappingIds(id: string): Promise<{ constructionSiteId: string }[]> {
    const { data, error } = await this.supabase
      .from('user_construction_sites_mapping')
      .select('construction_site_id')
      .eq('user_id', id);
    if (error) throw error;
    return ((data ?? []) as { construction_site_id: string }[]).map((m) => ({
      constructionSiteId: m.construction_site_id,
    }));
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

    const { error } = await this.supabase
      .from('users')
      .update({
        full_name: fullName,
        role,
        counterparty_id: role === 'counterparty_user' ? counterpartyId : null,
        department_id: role !== 'counterparty_user' ? department : null,
        all_sites: role === 'counterparty_user' ? false : allSites,
      })
      .eq('id', id);
    if (error) throw error;

    const { error: delErr } = await this.supabase
      .from('user_construction_sites_mapping')
      .delete()
      .eq('user_id', id);
    if (delErr) throw delErr;

    if (!allSites && role !== 'counterparty_user' && siteIds.length > 0) {
      const { error: insErr } = await this.supabase
        .from('user_construction_sites_mapping')
        .insert(siteIds.map((siteId) => ({ user_id: id, construction_site_id: siteId })));
      if (insErr) throw insErr;
    }

    if (department && role !== 'counterparty_user') {
      const { data: notifs } = await this.supabase
        .from('notifications')
        .select('id, department_id, site_id')
        .eq('type', 'missing_specialist')
        .eq('resolved', false)
        .eq('department_id', department);
      for (const n of (notifs ?? []) as {
        department_id: string;
        site_id: string | null;
      }[]) {
        const matches = allSites || (n.site_id !== null && siteIds.includes(n.site_id));
        // site_id IS NULL не резолвим (равенство по NULL не срабатывает); согласовано с Drizzle-impl.
        if (matches && n.site_id !== null) {
          await this.supabase
            .from('notifications')
            .update({ resolved: true, resolved_at: new Date().toISOString() })
            .eq('department_id', n.department_id)
            .eq('site_id', n.site_id)
            .eq('type', 'missing_specialist')
            .eq('resolved', false);
        }
      }
    }
  }

  async setSiteMappings(id: string, siteIds: string[]): Promise<void> {
    const { error: delErr } = await this.supabase
      .from('user_construction_sites_mapping')
      .delete()
      .eq('user_id', id);
    if (delErr) throw delErr;
    if (siteIds.length > 0) {
      const { error: insErr } = await this.supabase
        .from('user_construction_sites_mapping')
        .insert(siteIds.map((siteId) => ({ user_id: id, construction_site_id: siteId })));
      if (insErr) throw insErr;
    }
  }

  async createCounterpartyUserRecord(input: CounterpartyUserRecord): Promise<void> {
    const { error } = await this.supabase.from('users').insert({
      id: input.id,
      email: input.email,
      full_name: input.fullName,
      role: 'counterparty_user',
      counterparty_id: input.counterpartyId,
      all_sites: false,
    });
    if (error) throw error;
  }
}
