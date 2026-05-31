/**
 * SupabaseRepository для домена «Поставщик».
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SupplierRepository, SupplierApiListQuery, Actor } from '../supplier.repository.js';
import type {
  Supplier,
  CreateSupplierBody,
  UpdateSupplierBody,
  ListSuppliersQuery,
  SupplierListItem,
  SupplierSecurityCheck,
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

const CHECK_FIELDS = 'id, supplier_id, author_id, event_type, comment, created_at';

interface CheckRow {
  id: string;
  supplier_id: string;
  author_id: string;
  event_type: 'requested' | 'approved' | 'rejected';
  comment: string | null;
  created_at: string;
}

function checkToDto(row: CheckRow, authorFullName: string): SupplierSecurityCheck {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    authorId: row.author_id,
    authorFullName,
    eventType: row.event_type,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

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
    // .select('id') возвращает удалённые строки — пусто означает «не найдено» (контракт ⇒ NotFoundError).
    const { data, error } = await this.supabase
      .from('suppliers')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) {
      if ((error as { code?: string }).code === '23503') {
        throw new ForeignKeyConstraintError('Supplier', 'связанные договоры');
      }
      throw error;
    }
    if (!data || data.length === 0) throw new NotFoundError('Supplier', id);
  }

  async listAll(): Promise<Supplier[]> {
    const { data, error } = await this.supabase
      .from('suppliers')
      .select(SELECT_FIELDS)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as SupplierRow[]).map(rowToDto);
  }

  async batchCreate(rows: { name: string; inn: string }[]): Promise<number> {
    const BATCH_SIZE = 20;
    let created = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({
        name: r.name,
        inn: r.inn,
        alternative_names: [] as string[],
      }));
      const { error } = await this.supabase.from('suppliers').insert(batch);
      if (error) throw error;
      created += batch.length;
    }
    return created;
  }

  async listForApi(
    query: SupplierApiListQuery,
  ): Promise<{ items: SupplierListItem[]; total: number }> {
    const { data, error } = await this.supabase.rpc('list_suppliers_with_sb', {
      p_search: query.search ?? null,
      p_sb_filter: query.sbFilter,
      p_page: query.page,
      p_page_size: query.pageSize,
      p_cutoff_date: query.cutoffDate,
      p_only_supplier_id: null,
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<{
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
    const { data, error } = await this.supabase
      .from('supplier_security_checks')
      .select(CHECK_FIELDS)
      .eq('supplier_id', supplierId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as CheckRow[];
    if (rows.length === 0) return [];
    // Имена авторов отдельным запросом (без PostgREST-вложенного join — для совместимости).
    const authorIds = Array.from(new Set(rows.map((r) => r.author_id)));
    const { data: authors, error: authErr } = await this.supabase
      .from('users')
      .select('id, full_name')
      .in('id', authorIds);
    if (authErr) throw authErr;
    const nameById = new Map(
      ((authors ?? []) as { id: string; full_name: string | null }[]).map((u) => [
        u.id,
        u.full_name ?? '',
      ]),
    );
    return rows.map((r) => checkToDto(r, nameById.get(r.author_id) ?? ''));
  }

  async requestSecurityCheck(supplierId: string, actor: Actor): Promise<SupplierSecurityCheck> {
    const { data: sup, error: supErr } = await this.supabase
      .from('suppliers')
      .select('id, name')
      .eq('id', supplierId)
      .maybeSingle();
    if (supErr) throw supErr;
    if (!sup) throw new NotFoundError('Supplier', supplierId);

    const { data: lastEvent } = await this.supabase
      .from('supplier_security_checks')
      .select('event_type')
      .eq('supplier_id', supplierId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastEvent && (lastEvent as { event_type: string }).event_type === 'requested') {
      throw new ConflictError('Поставщик уже на проверке');
    }

    const { data: created, error: insErr } = await this.supabase
      .from('supplier_security_checks')
      .insert({
        supplier_id: supplierId,
        author_id: actor.id,
        event_type: 'requested',
        comment: null,
      })
      .select(CHECK_FIELDS)
      .single();
    if (insErr) throw insErr;

    const { data: sbUsers } = await this.supabase
      .from('users')
      .select('id')
      .eq('role', 'security')
      .eq('is_active', true);
    if (sbUsers && sbUsers.length > 0) {
      const notifications = (sbUsers as { id: string }[]).map((u) => ({
        type: 'sb_review_requested',
        title: 'Новый запрос на проверку поставщика',
        message: `${actor.fullName} отправил поставщика «${(sup as { name: string }).name}» на проверку СБ`,
        user_id: u.id,
        supplier_id: supplierId,
      }));
      await this.supabase.from('notifications').insert(notifications);
    }

    return checkToDto(created as CheckRow, actor.fullName);
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

    const { data: sup, error: supErr } = await this.supabase
      .from('suppliers')
      .select('id, name')
      .eq('id', supplierId)
      .maybeSingle();
    if (supErr) throw supErr;
    if (!sup) throw new NotFoundError('Supplier', supplierId);

    const { data: lastDecision } = await this.supabase
      .from('supplier_security_checks')
      .select('created_at')
      .eq('supplier_id', supplierId)
      .in('event_type', ['approved', 'rejected'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let openRequests: { author_id: string }[] = [];
    const lastDecisionAt = (lastDecision as { created_at?: string } | null)?.created_at;
    if (lastDecisionAt) {
      const { data: rs } = await this.supabase
        .from('supplier_security_checks')
        .select('author_id')
        .eq('supplier_id', supplierId)
        .eq('event_type', 'requested')
        .gt('created_at', lastDecisionAt);
      openRequests = (rs as { author_id: string }[]) ?? [];
    } else {
      const { data: rs } = await this.supabase
        .from('supplier_security_checks')
        .select('author_id')
        .eq('supplier_id', supplierId)
        .eq('event_type', 'requested');
      openRequests = (rs as { author_id: string }[]) ?? [];
    }

    const { data: created, error: insErr } = await this.supabase
      .from('supplier_security_checks')
      .insert({
        supplier_id: supplierId,
        author_id: actor.id,
        event_type: decision,
        comment: comment?.trim() || null,
      })
      .select(CHECK_FIELDS)
      .single();
    if (insErr) throw insErr;

    await this.supabase
      .from('suppliers')
      .update({ last_security_status: decision })
      .eq('id', supplierId);

    const initiatorIds = Array.from(new Set(openRequests.map((r) => r.author_id))).filter(
      (uid) => uid !== actor.id,
    );
    if (initiatorIds.length > 0) {
      const decisionLabel = decision === 'approved' ? 'согласован' : 'отклонён';
      const notifications = initiatorIds.map((uid) => ({
        type: 'sb_review_decided',
        title: 'Решение по проверке поставщика',
        message: `Поставщик «${(sup as { name: string }).name}» ${decisionLabel} отделом СБ`,
        user_id: uid,
        supplier_id: supplierId,
      }));
      await this.supabase.from('notifications').insert(notifications);
    }

    return checkToDto(created as CheckRow, actor.fullName);
  }
}
