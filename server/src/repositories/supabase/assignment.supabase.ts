/**
 * SupabaseAssignmentRepository — rollback-провайдер назначений (Iteration 5).
 * Дословный порт routes/assignments.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssignmentRepository, CreateAssignmentInput, Row } from '../assignment.repository.js';

const ASSIGNMENT_SELECT = `
  id, payment_request_id, assigned_user_id, assigned_by_user_id, assigned_at, is_current, created_at,
  assigned_user:users!payment_request_assignments_assigned_user_id_fkey(email, full_name),
  assigned_by_user:users!payment_request_assignments_assigned_by_user_id_fkey(email)
`;

function flattenAssignment(row: Row): Row {
  const assignedUser = row.assigned_user as Row | null;
  const assignedByUser = row.assigned_by_user as Row | null;
  const flat = { ...row };
  delete flat.assigned_user;
  delete flat.assigned_by_user;
  flat.assigned_user_email = assignedUser?.email ?? null;
  flat.assigned_user_full_name = assignedUser?.full_name ?? null;
  flat.assigned_by_user_email = assignedByUser?.email ?? null;
  return flat;
}

export class SupabaseAssignmentRepository implements AssignmentRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getCurrent(paymentRequestId: string): Promise<Row | null> {
    const { data: current } = await this.supabase
      .from('payment_request_assignments')
      .select(ASSIGNMENT_SELECT)
      .eq('payment_request_id', paymentRequestId)
      .eq('is_current', true)
      .maybeSingle();
    return current ? flattenAssignment(current as Row) : null;
  }

  async listByRequest(paymentRequestId: string): Promise<Row[]> {
    const { data: history, error } = await this.supabase
      .from('payment_request_assignments')
      .select(ASSIGNMENT_SELECT)
      .eq('payment_request_id', paymentRequestId)
      .order('assigned_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (history ?? []).map((row: Row) => flattenAssignment(row));
  }

  async create(input: CreateAssignmentInput): Promise<void> {
    await this.supabase
      .from('payment_request_assignments')
      .update({ is_current: false })
      .eq('payment_request_id', input.paymentRequestId)
      .eq('is_current', true);

    const { error } = await this.supabase.from('payment_request_assignments').insert({
      payment_request_id: input.paymentRequestId,
      assigned_user_id: input.assignedUserId,
      assigned_by_user_id: input.assignedByUserId,
      is_current: true,
    });
    if (error) throw new Error(error.message);
  }

  async listOmtsUsers(): Promise<Row[]> {
    const { data, error } = await this.supabase
      .from('users')
      .select('id, email, full_name')
      .eq('department_id', 'omts')
      .eq('is_active', true)
      .in('role', ['admin', 'user'])
      .order('full_name', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }
}
