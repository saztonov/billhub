import type { SupabaseClient } from '@supabase/supabase-js';

/* ------------------------------------------------------------------ */
/*  Тип записи уведомления                                             */
/* ------------------------------------------------------------------ */

export interface NotificationInsert {
  user_id: string;
  type: string;
  title: string;
  message: string;
  payment_request_id?: string;
  contract_request_id?: string;
  department_id?: 'omts' | 'shtab' | 'smetny';
  site_id?: string;
}

/* ------------------------------------------------------------------ */
/*  Вставка уведомлений пачкой                                         */
/* ------------------------------------------------------------------ */

export async function insertNotifications(
  supabase: SupabaseClient,
  rows: NotificationInsert[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from('notifications').insert(rows);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/*  Получение пользователей по критериям                               */
/* ------------------------------------------------------------------ */

/** Пользователи подразделения, привязанные к объекту (или all_sites) */
export async function getUsersByDepartmentAndSite(
  supabase: SupabaseClient,
  department: string,
  siteId: string,
  excludeUserId?: string,
): Promise<string[]> {
  // Пользователи с all_sites = true
  const { data: allSitesUsers } = await supabase
    .from('users')
    .select('id')
    .eq('department_id', department)
    .eq('all_sites', true)
    .eq('is_active', true)
    .neq('role', 'counterparty_user');

  // Пользователи, привязанные к конкретному объекту
  const { data: mappings } = await supabase
    .from('user_construction_sites_mapping')
    .select('user_id')
    .eq('construction_site_id', siteId);

  const siteUserIds = (mappings ?? []).map((m) => m.user_id);

  let deptSiteUsers: string[] = [];
  if (siteUserIds.length > 0) {
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('department_id', department)
      .eq('is_active', true)
      .neq('role', 'counterparty_user')
      .eq('all_sites', false)
      .in('id', siteUserIds);
    deptSiteUsers = (data ?? []).map((u) => u.id);
  }

  const ids = new Set([
    ...(allSitesUsers ?? []).map((u) => u.id),
    ...deptSiteUsers,
  ]);
  if (excludeUserId) ids.delete(excludeUserId);
  return Array.from(ids);
}

/** Создатель заявки на оплату */
export async function getPaymentRequestCreator(
  supabase: SupabaseClient,
  paymentRequestId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('payment_requests')
    .select('created_by')
    .eq('id', paymentRequestId)
    .single();
  return data?.created_by ?? null;
}

/** Создатель заявки на договор */
export async function getContractRequestCreator(
  supabase: SupabaseClient,
  contractRequestId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('contract_requests')
    .select('created_by')
    .eq('id', contractRequestId)
    .single();
  return data?.created_by ?? null;
}

/** Получить site_id и current_stage заявки на оплату */
export async function getPaymentRequestInfo(
  supabase: SupabaseClient,
  paymentRequestId: string,
): Promise<{ site_id: string; current_stage: number; created_by: string } | null> {
  const { data } = await supabase
    .from('payment_requests')
    .select('site_id, current_stage, created_by')
    .eq('id', paymentRequestId)
    .single();
  return data ?? null;
}

/** Получить site_id заявки на договор */
export async function getContractRequestInfo(
  supabase: SupabaseClient,
  contractRequestId: string,
): Promise<{ site_id: string; created_by: string } | null> {
  const { data } = await supabase
    .from('contract_requests')
    .select('site_id, created_by')
    .eq('id', contractRequestId)
    .single();
  return data ?? null;
}

/** Администраторы */
export async function getAdminUserIds(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .eq('is_active', true);
  return (data ?? []).map((u) => u.id);
}

/** Пользователи ОМТС, привязанные к объекту заявки на оплату */
export async function getOmtsRpUsers(
  supabase: SupabaseClient,
  paymentRequestId: string,
): Promise<string[]> {
  const info = await getPaymentRequestInfo(supabase, paymentRequestId);
  if (!info) return [];
  return getUsersByDepartmentAndSite(supabase, 'omts', info.site_id);
}

/* ------------------------------------------------------------------ */
/*  Определение получателей уведомлений                                */
/* ------------------------------------------------------------------ */

/** Известные значения recipient — это департаменты, а не userId */
const DEPARTMENT_RECIPIENTS = ['shtab', 'omts', 'smetny', 'counterparty'];

/**
 * Получатели комментария к заявке на оплату.
 * recipient может быть:
 *   - null / undefined — всем (создателю + штабу объекта)
 *   - "shtab" / "omts" / "smetny" — всем пользователям указанного департамента на объекте
 *   - "counterparty" — контрагенту-создателю заявки
 *   - конкретный userId — только этому пользователю
 */
export async function resolveCommentRecipients(
  supabase: SupabaseClient,
  paymentRequestId: string,
  actorUserId: string,
  recipient: string | null | undefined,
): Promise<string[]> {
  const info = await getPaymentRequestInfo(supabase, paymentRequestId);
  if (!info) return [];

  const ids = new Set<string>();

  if (recipient && DEPARTMENT_RECIPIENTS.includes(recipient)) {
    // Recipient — название департамента: уведомляем всех пользователей этого департамента на объекте
    if (recipient === 'counterparty') {
      // Уведомить создателя заявки (контрагента)
      if (info.created_by !== actorUserId) ids.add(info.created_by);
    } else {
      const deptUsers = await getUsersByDepartmentAndSite(
        supabase, recipient, info.site_id, actorUserId,
      );
      deptUsers.forEach((id) => ids.add(id));
    }
  } else if (recipient) {
    // Recipient — конкретный userId
    if (recipient !== actorUserId) ids.add(recipient);
  } else {
    // Без recipient — всем: создателю + штабу объекта
    if (info.created_by !== actorUserId) {
      ids.add(info.created_by);
    }
    const shtabUsers = await getUsersByDepartmentAndSite(
      supabase, 'shtab', info.site_id, actorUserId,
    );
    shtabUsers.forEach((id) => ids.add(id));
  }

  return Array.from(ids);
}

/**
 * Получатели уведомления о новом файле к заявке на оплату.
 * Создатель + штаб объекта (кроме автора действия).
 */
export async function resolveFileRecipients(
  supabase: SupabaseClient,
  paymentRequestId: string,
  actorUserId: string,
): Promise<string[]> {
  const info = await getPaymentRequestInfo(supabase, paymentRequestId);
  if (!info) return [];

  const ids = new Set<string>();

  if (info.created_by !== actorUserId) {
    ids.add(info.created_by);
  }

  const shtabUsers = await getUsersByDepartmentAndSite(
    supabase, 'shtab', info.site_id, actorUserId,
  );
  shtabUsers.forEach((id) => ids.add(id));

  return Array.from(ids);
}

/**
 * Получатели комментария к заявке на договор.
 */
export async function resolveContractCommentRecipients(
  supabase: SupabaseClient,
  contractRequestId: string,
  actorUserId: string,
  recipient: string | null | undefined,
): Promise<string[]> {
  const info = await getContractRequestInfo(supabase, contractRequestId);
  if (!info) return [];

  const ids = new Set<string>();

  if (recipient && DEPARTMENT_RECIPIENTS.includes(recipient)) {
    // Recipient — название департамента
    if (recipient === 'counterparty') {
      if (info.created_by !== actorUserId) ids.add(info.created_by);
    } else {
      const deptUsers = await getUsersByDepartmentAndSite(
        supabase, recipient, info.site_id, actorUserId,
      );
      deptUsers.forEach((id) => ids.add(id));
    }
  } else if (recipient) {
    // Recipient — конкретный userId
    if (recipient !== actorUserId) ids.add(recipient);
  } else {
    // Без recipient — всем: создателю + ОМТС объекта
    if (info.created_by !== actorUserId) {
      ids.add(info.created_by);
    }
    const omtsUsers = await getUsersByDepartmentAndSite(
      supabase, 'omts', info.site_id, actorUserId,
    );
    omtsUsers.forEach((id) => ids.add(id));
  }

  return Array.from(ids);
}

/**
 * Получатели уведомления о новом файле к заявке на договор.
 */
export async function resolveContractFileRecipients(
  supabase: SupabaseClient,
  contractRequestId: string,
  actorUserId: string,
): Promise<string[]> {
  const info = await getContractRequestInfo(supabase, contractRequestId);
  if (!info) return [];

  const ids = new Set<string>();

  if (info.created_by !== actorUserId) {
    ids.add(info.created_by);
  }

  const omtsUsers = await getUsersByDepartmentAndSite(
    supabase, 'omts', info.site_id, actorUserId,
  );
  omtsUsers.forEach((id) => ids.add(id));

  return Array.from(ids);
}
