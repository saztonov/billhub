/**
 * SupabaseRepository для комментариев (Strangler Fig, rollback-инструмент).
 * Данные автора подгружаются отдельными запросами (без PostgREST-вложенного join).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommentRepository, UnreadCounts } from '../comment.repository.js';
import type {
  CommentDto,
  CreatePaymentCommentBody,
  CreateContractCommentBody,
} from '../../schemas/comment.js';

interface CommentRow {
  id: string;
  payment_request_id?: string;
  contract_request_id?: string;
  author_id: string;
  text: string;
  created_at: string;
  updated_at: string | null;
  recipient: string | null;
}
interface UserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  department_id: string | null;
  counterparty_id: string | null;
}

const PAYMENT_FIELDS = 'id, payment_request_id, author_id, text, created_at, updated_at, recipient';
const CONTRACT_FIELDS =
  'id, contract_request_id, author_id, text, created_at, updated_at, recipient';

function uniq(ids: (string | null | undefined)[]): string[] {
  return Array.from(new Set(ids.filter((x): x is string => !!x)));
}

export class SupabaseCommentRepository implements CommentRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /** Обогащает строки комментариев данными автора (и контрагента автора). */
  private async enrich(rows: CommentRow[], kind: 'payment' | 'contract'): Promise<CommentDto[]> {
    if (rows.length === 0) return [];
    const authorIds = uniq(rows.map((r) => r.author_id));
    const { data: users, error: uErr } = await this.supabase
      .from('users')
      .select('id, full_name, email, role, department_id, counterparty_id')
      .in('id', authorIds);
    if (uErr) throw uErr;
    const userRows = (users ?? []) as UserRow[];
    const cpIds = uniq(userRows.map((u) => u.counterparty_id));
    let cpName = new Map<string, string>();
    if (cpIds.length > 0) {
      const { data: cps, error: cErr } = await this.supabase
        .from('counterparties')
        .select('id, name')
        .in('id', cpIds);
      if (cErr) throw cErr;
      cpName = new Map(((cps ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
    }
    const userById = new Map(userRows.map((u) => [u.id, u]));

    return rows.map((r) => {
      const u = userById.get(r.author_id);
      const dto: CommentDto = {
        id: r.id,
        authorId: r.author_id,
        text: r.text,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        recipient: r.recipient,
        authorFullName: u?.full_name ?? null,
        authorEmail: u?.email ?? null,
        authorRole: u?.role ?? null,
        authorDepartment: u?.department_id ?? null,
        authorCounterpartyName: u?.counterparty_id ? (cpName.get(u.counterparty_id) ?? null) : null,
      };
      if (kind === 'payment') dto.paymentRequestId = r.payment_request_id;
      else dto.contractRequestId = r.contract_request_id;
      return dto;
    });
  }

  private async computeUnread(
    table: string,
    readTable: string,
    requestCol: string,
    userId: string,
  ): Promise<UnreadCounts> {
    const { data: comments, error: cErr } = await this.supabase
      .from(table)
      .select(`${requestCol}, created_at`)
      .neq('author_id', userId);
    if (cErr) throw cErr;
    const { data: reads, error: rErr } = await this.supabase
      .from(readTable)
      .select(`${requestCol}, last_read_at`)
      .eq('user_id', userId);
    if (rErr) throw rErr;

    const readMap: Record<string, string> = {};
    for (const rs of (reads ?? []) as unknown as Record<string, unknown>[]) {
      readMap[rs[requestCol] as string] = rs.last_read_at as string;
    }
    const counts: UnreadCounts = {};
    for (const c of (comments ?? []) as unknown as Record<string, unknown>[]) {
      const rid = c[requestCol] as string;
      const lastRead = readMap[rid];
      if (!lastRead || new Date(c.created_at as string) > new Date(lastRead)) {
        counts[rid] = (counts[rid] || 0) + 1;
      }
    }
    return counts;
  }

  /** Идемпотентная отметка прочтения (update, а при отсутствии — insert). */
  private async upsertRead(
    table: string,
    requestCol: string,
    userId: string,
    requestId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const { data: updated, error: uErr } = await this.supabase
      .from(table)
      .update({ last_read_at: now })
      .eq('user_id', userId)
      .eq(requestCol, requestId)
      .select('id');
    if (uErr) throw uErr;
    if (!updated || (updated as unknown[]).length === 0) {
      const { error: iErr } = await this.supabase
        .from(table)
        .insert({ user_id: userId, [requestCol]: requestId, last_read_at: now });
      if (iErr) throw iErr;
    }
  }

  /* --------------------------- Комментарии к заявкам на оплату --------------------------- */

  async listPaymentComments(requestId: string): Promise<CommentDto[]> {
    const { data, error } = await this.supabase
      .from('payment_request_comments')
      .select(PAYMENT_FIELDS)
      .eq('payment_request_id', requestId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return this.enrich((data ?? []) as CommentRow[], 'payment');
  }

  async createPaymentComment(authorId: string, body: CreatePaymentCommentBody): Promise<void> {
    const { error } = await this.supabase.from('payment_request_comments').insert({
      payment_request_id: body.paymentRequestId,
      author_id: authorId,
      text: body.text,
      recipient: body.recipient || null,
    });
    if (error) throw error;
  }

  async updatePaymentComment(id: string, text: string): Promise<void> {
    const { error } = await this.supabase
      .from('payment_request_comments')
      .update({ text, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }

  async deletePaymentComment(id: string): Promise<void> {
    const { error } = await this.supabase.from('payment_request_comments').delete().eq('id', id);
    if (error) throw error;
  }

  async markReadPayment(userId: string, requestId: string): Promise<void> {
    await this.upsertRead('comment_read_status', 'payment_request_id', userId, requestId);
  }

  async unreadCountsPayment(userId: string): Promise<UnreadCounts> {
    return this.computeUnread(
      'payment_request_comments',
      'comment_read_status',
      'payment_request_id',
      userId,
    );
  }

  /* --------------------------- Комментарии к заявкам на договор --------------------------- */

  async listContractComments(requestId: string): Promise<CommentDto[]> {
    const { data, error } = await this.supabase
      .from('contract_request_comments')
      .select(CONTRACT_FIELDS)
      .eq('contract_request_id', requestId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return this.enrich((data ?? []) as CommentRow[], 'contract');
  }

  async createContractComment(authorId: string, body: CreateContractCommentBody): Promise<void> {
    const { error } = await this.supabase.from('contract_request_comments').insert({
      contract_request_id: body.contractRequestId,
      author_id: authorId,
      text: body.text,
      recipient: body.recipient || null,
    });
    if (error) throw error;
  }

  async updateContractComment(id: string, text: string): Promise<void> {
    const { error } = await this.supabase
      .from('contract_request_comments')
      .update({ text, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }

  async deleteContractComment(id: string): Promise<void> {
    const { error } = await this.supabase.from('contract_request_comments').delete().eq('id', id);
    if (error) throw error;
  }

  async markReadContract(userId: string, requestId: string): Promise<void> {
    await this.upsertRead('contract_comment_read_status', 'contract_request_id', userId, requestId);
  }

  async unreadCountsContract(userId: string): Promise<UnreadCounts> {
    return this.computeUnread(
      'contract_request_comments',
      'contract_comment_read_status',
      'contract_request_id',
      userId,
    );
  }
}
