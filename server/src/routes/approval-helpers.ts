import type { FastifyInstance } from 'fastify';

/** Получить id статуса по entity_type и code */
export async function getStatusId(
  supabase: FastifyInstance['supabase'],
  entityType: string,
  code: string
): Promise<string> {
  const { data, error } = await supabase
    .from('statuses')
    .select('id')
    .eq('entity_type', entityType)
    .eq('code', code)
    .single();
  if (error || !data) throw new Error(`Статус ${entityType}/${code} не найден`);
  return data.id as string;
}

/** Добавить запись в stage_history заявки */
export async function appendStageHistory(
  supabase: FastifyInstance['supabase'],
  paymentRequestId: string,
  entry: Record<string, unknown>
): Promise<void> {
  const { data } = await supabase
    .from('payment_requests')
    .select('stage_history')
    .eq('id', paymentRequestId)
    .single();
  const history = (data?.stage_history as Record<string, unknown>[]) ?? [];
  history.push({ ...entry, at: new Date().toISOString() });
  await supabase
    .from('payment_requests')
    .update({ stage_history: history })
    .eq('id', paymentRequestId);
}

/** Получить email и full_name пользователя */
export async function getUserInfo(
  supabase: FastifyInstance['supabase'],
  userId: string
): Promise<{ email?: string; fullName?: string }> {
  const { data } = await supabase
    .from('users')
    .select('email, full_name')
    .eq('id', userId)
    .single();
  return { email: data?.email as string | undefined, fullName: data?.full_name as string | undefined };
}

/** Получить id объектов пользователя */
export async function getUserSiteIds(
  supabase: FastifyInstance['supabase'],
  userId: string
): Promise<{ allSites: boolean; siteIds: string[] }> {
  const { data: userData } = await supabase
    .from('users')
    .select('all_sites')
    .eq('id', userId)
    .single();
  const allSites = (userData?.all_sites as boolean) ?? false;
  if (allSites) return { allSites: true, siteIds: [] };

  const { data: siteMappings } = await supabase
    .from('user_construction_sites_mapping')
    .select('construction_site_id')
    .eq('user_id', userId);
  const siteIds = (siteMappings ?? []).map((s: Record<string, unknown>) => s.construction_site_id as string);
  return { allSites: false, siteIds };
}

/** Общий select для payment_requests с join-ами */
export const PR_SELECT = `
  *,
  counterparties(name),
  construction_sites(name),
  statuses!payment_requests_status_id_fkey(name, color),
  shipping:payment_request_field_options!payment_requests_shipping_condition_id_fkey(value),
  current_assignment:payment_request_assignments!left(
    assigned_user_id,
    is_current,
    assigned_user:users!payment_request_assignments_assigned_user_id_fkey(email, full_name)
  )
`;
