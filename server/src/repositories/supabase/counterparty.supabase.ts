/**
 * SupabaseRepository для домена «Контрагент».
 * Обёртка над `@supabase/supabase-js`, реализующая интерфейс CounterpartyRepository.
 *
 * Конвертация snake_case → camelCase делается здесь, чтобы вызывающий код
 * (роуты, сервисы) работал только с camelCase DTO.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
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

const SELECT_FIELDS = 'id, name, inn, address, alternative_names, registration_token, created_at';

type CounterpartyRow = {
  id: string;
  name: string;
  inn: string;
  address: string | null;
  alternative_names: string[] | null;
  registration_token: string | null;
  created_at: string;
};

function rowToDto(row: CounterpartyRow): Counterparty {
  return {
    id: row.id,
    name: row.name,
    inn: row.inn,
    address: row.address ?? '',
    alternativeNames: row.alternative_names ?? [],
    registrationToken: row.registration_token,
    createdAt: row.created_at,
  };
}

export class SupabaseCounterpartyRepository implements CounterpartyRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getById(id: string): Promise<Counterparty> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError('Counterparty', id);
    return found;
  }

  async findById(id: string): Promise<Counterparty | null> {
    const { data, error } = await this.supabase
      .from('counterparties')
      .select(SELECT_FIELDS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToDto(data as CounterpartyRow) : null;
  }

  async findByInn(inn: string): Promise<Counterparty | null> {
    const { data, error } = await this.supabase
      .from('counterparties')
      .select(SELECT_FIELDS)
      .eq('inn', inn)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToDto(data as CounterpartyRow) : null;
  }

  async list(query: ListCounterpartiesQuery): Promise<PaginatedResult<Counterparty>> {
    // RPC list_counterparties_with_sb для агрегатов last_security_status и has_pending_request.
    // Сигнатура: (p_search text, p_sb_filter text, p_page int, p_page_size int, p_cutoff_date date, p_only_counterparty_id uuid)
    const { data, error } = await this.supabase.rpc('list_counterparties_with_sb', {
      p_search: query.search ?? null,
      p_sb_filter: query.sbFilter,
      p_page: query.page,
      p_page_size: query.pageSize,
      p_cutoff_date: query.cutoffDate ?? null,
      p_only_counterparty_id: query.onlyCounterpartyId ?? null,
    });
    if (error) throw error;

    const rows =
      (data as Array<
        CounterpartyRow & {
          last_security_status: 'approved' | 'rejected' | null;
          has_pending_request: boolean;
          total_count: number;
        }
      >) ?? [];

    if (rows.length === 0 || !rows[0]) return { items: [], totalCount: 0 };

    return {
      items: rows.map((row) => ({
        ...rowToDto(row),
        lastSecurityStatus: row.last_security_status,
        hasPendingRequest: row.has_pending_request,
      })),
      totalCount: rows[0].total_count,
    };
  }

  async create(body: CreateCounterpartyBody): Promise<Counterparty> {
    const { data, error } = await this.supabase
      .from('counterparties')
      .insert({
        name: body.name,
        inn: body.inn,
        address: body.address ?? '',
        alternative_names: body.alternativeNames ?? [],
      })
      .select(SELECT_FIELDS)
      .single();
    if (error) {
      // 23505 — unique violation в PostgreSQL
      if ((error as { code?: string }).code === '23505') {
        throw new UniqueConstraintError('Counterparty', 'inn', body.inn);
      }
      throw error;
    }
    return rowToDto(data as CounterpartyRow);
  }

  async update(id: string, body: UpdateCounterpartyBody): Promise<Counterparty> {
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.inn !== undefined) patch.inn = body.inn;
    if (body.address !== undefined) patch.address = body.address;
    if (body.alternativeNames !== undefined) patch.alternative_names = body.alternativeNames;

    const { data, error } = await this.supabase
      .from('counterparties')
      .update(patch)
      .eq('id', id)
      .select(SELECT_FIELDS)
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505' && body.inn) {
        throw new UniqueConstraintError('Counterparty', 'inn', body.inn);
      }
      if ((error as { code?: string }).code === 'PGRST116') {
        throw new NotFoundError('Counterparty', id);
      }
      throw error;
    }
    return rowToDto(data as CounterpartyRow);
  }

  async delete(id: string): Promise<void> {
    // .select('id') возвращает удалённые строки — пусто означает «не найдено» (контракт ⇒ NotFoundError).
    const { data, error } = await this.supabase
      .from('counterparties')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) {
      // 23503 — foreign key violation
      if ((error as { code?: string }).code === '23503') {
        throw new ForeignKeyConstraintError('Counterparty', 'связанные заявки/файлы');
      }
      throw error;
    }
    if (!data || data.length === 0) throw new NotFoundError('Counterparty', id);
  }
}
