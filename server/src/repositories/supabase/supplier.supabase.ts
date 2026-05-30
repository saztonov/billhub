/**
 * SupabaseRepository для домена «Поставщик».
 */
import type { SupabaseClient } from '@supabase/supabase-js';
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

const SELECT_FIELDS =
  'id, name, inn, alternative_names, created_at, founding_documents_comment, last_security_status';

type SupplierRow = {
  id: string;
  name: string;
  inn: string;
  alternative_names: string[] | null;
  created_at: string;
  founding_documents_comment: string | null;
  last_security_status: 'approved' | 'rejected' | null;
};

function rowToDto(row: SupplierRow): Supplier {
  return {
    id: row.id,
    name: row.name,
    inn: row.inn,
    alternativeNames: row.alternative_names ?? [],
    createdAt: row.created_at,
    foundingDocumentsComment: row.founding_documents_comment,
    lastSecurityStatus: row.last_security_status,
  };
}

export class SupabaseSupplierRepository implements SupplierRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getById(id: string): Promise<Supplier> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError('Supplier', id);
    return found;
  }

  async findById(id: string): Promise<Supplier | null> {
    const { data, error } = await this.supabase
      .from('suppliers')
      .select(SELECT_FIELDS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToDto(data as SupplierRow) : null;
  }

  async findByInn(inn: string): Promise<Supplier | null> {
    const { data, error } = await this.supabase
      .from('suppliers')
      .select(SELECT_FIELDS)
      .eq('inn', inn)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToDto(data as SupplierRow) : null;
  }

  async list(query: ListSuppliersQuery): Promise<PaginatedResult<Supplier>> {
    const { data, error } = await this.supabase.rpc('list_suppliers_with_sb', {
      p_search: query.search ?? null,
      p_sb_filter: query.sbFilter,
      p_page: query.page,
      p_page_size: query.pageSize,
      p_cutoff_date: query.cutoffDate ?? null,
      p_only_supplier_id: query.onlySupplierId ?? null,
    });
    if (error) throw error;

    const rows =
      (data as Array<
        SupplierRow & {
          has_pending_request: boolean;
          total_count: number;
        }
      >) ?? [];

    if (rows.length === 0 || !rows[0]) return { items: [], totalCount: 0 };

    return {
      items: rows.map((row) => ({
        ...rowToDto(row),
        hasPendingRequest: row.has_pending_request,
      })),
      totalCount: rows[0].total_count,
    };
  }

  async create(body: CreateSupplierBody): Promise<Supplier> {
    const { data, error } = await this.supabase
      .from('suppliers')
      .insert({
        name: body.name,
        inn: body.inn,
        alternative_names: body.alternativeNames ?? [],
      })
      .select(SELECT_FIELDS)
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new UniqueConstraintError('Supplier', 'inn', body.inn);
      }
      throw error;
    }
    return rowToDto(data as SupplierRow);
  }

  async update(id: string, body: UpdateSupplierBody): Promise<Supplier> {
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.inn !== undefined) patch.inn = body.inn;
    if (body.alternativeNames !== undefined) patch.alternative_names = body.alternativeNames;
    if (body.foundingDocumentsComment !== undefined) {
      patch.founding_documents_comment = body.foundingDocumentsComment;
    }

    const { data, error } = await this.supabase
      .from('suppliers')
      .update(patch)
      .eq('id', id)
      .select(SELECT_FIELDS)
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505' && body.inn) {
        throw new UniqueConstraintError('Supplier', 'inn', body.inn);
      }
      if ((error as { code?: string }).code === 'PGRST116') {
        throw new NotFoundError('Supplier', id);
      }
      throw error;
    }
    return rowToDto(data as SupplierRow);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from('suppliers').delete().eq('id', id);
    if (error) {
      if ((error as { code?: string }).code === '23503') {
        throw new ForeignKeyConstraintError('Supplier', 'связанные договоры');
      }
      throw error;
    }
  }
}
