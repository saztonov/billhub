import { supabase } from '@/services/supabase'
import { logError } from '@/services/errorLogger'
import type { Department, RevisionTarget } from '@/types'

// --- Внутренние функции определения получателей ---

/** Контекст заявки на договор */
interface ContractRequestContext {
  requestNumber: string
  counterpartyId: string
  siteId: string
  statusCode: string | null
}

/** Загружает контекст заявки на договор */
async function getContractRequestContext(contractRequestId: string): Promise<ContractRequestContext | null> {
  const { data } = await supabase
    .from('contract_requests')
    .select('request_number, counterparty_id, site_id, statuses!contract_requests_status_id_fkey(code)')
    .eq('id', contractRequestId)
    .single()
  if (!data) return null
  const statusObj = data.statuses as unknown as { code: string } | null
  return {
    requestNumber: data.request_number as string,
    counterpartyId: data.counterparty_id as string,
    siteId: data.site_id as string,
    statusCode: statusObj?.code ?? null,
  }
}

/** Получает id всех активных counterparty_user контрагента */
async function getCounterpartyRecipients(counterpartyId: string, excludeUserId?: string): Promise<string[]> {
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('counterparty_id', counterpartyId)
    .eq('role', 'counterparty_user')
    .eq('is_active', true)
  if (!data) return []
  return (data as { id: string }[])
    .map((u) => u.id)
    .filter((id) => id !== excludeUserId)
}

/** Получает id Штаб-сотрудников с доступом к объекту */
async function getShtabRecipientsForSite(siteId: string, excludeUserId?: string): Promise<string[]> {
  const { data: users } = await supabase
    .from('users')
    .select('id, all_sites')
    .eq('department_id', 'shtab')
    .eq('is_active', true)
    .in('role', ['admin', 'user'])
  if (!users || users.length === 0) return []

  const recipients: string[] = []
  for (const u of users as { id: string; all_sites: boolean }[]) {
    if (u.id === excludeUserId) continue
    if (u.all_sites) {
      recipients.push(u.id)
      continue
    }
    const { data: mapping } = await supabase
      .from('user_construction_sites_mapping')
      .select('id')
      .eq('user_id', u.id)
      .eq('construction_site_id', siteId)
      .limit(1)
    if (mapping && mapping.length > 0) {
      recipients.push(u.id)
    }
  }
  return recipients
}

/** Получает id ОМТС-сотрудников с доступом к объекту */
async function getOmtsRecipientsForSite(siteId: string, excludeUserId?: string): Promise<string[]> {
  const { data: users } = await supabase
    .from('users')
    .select('id, all_sites')
    .eq('department_id', 'omts')
    .eq('is_active', true)
    .in('role', ['admin', 'user'])
  if (!users || users.length === 0) return []

  const recipients: string[] = []
  for (const u of users as { id: string; all_sites: boolean }[]) {
    if (u.id === excludeUserId) continue
    if (u.all_sites) {
      recipients.push(u.id)
      continue
    }
    const { data: mapping } = await supabase
      .from('user_construction_sites_mapping')
      .select('id')
      .eq('user_id', u.id)
      .eq('construction_site_id', siteId)
      .limit(1)
    if (mapping && mapping.length > 0) {
      recipients.push(u.id)
    }
  }
  return recipients
}

/** Массовая вставка уведомлений */
async function insertNotifications(
  recipientIds: string[],
  data: {
    type: string
    title: string
    message: string
    contractRequestId: string
    siteId?: string
    departmentId?: Department
  },
): Promise<void> {
  if (recipientIds.length === 0) return
  const rows = recipientIds.map((userId) => ({
    type: data.type,
    title: data.title,
    message: data.message,
    user_id: userId,
    contract_request_id: data.contractRequestId,
    site_id: data.siteId ?? null,
    department_id: data.departmentId ?? null,
  }))
  await supabase.from('notifications').insert(rows)
}

// --- Экспортируемые функции уведомлений ---

/** Уведомление ОМТС о новой заявке на согласование договора */
export async function notifyContractNewRequest(
  contractRequestId: string,
  siteId: string,
  actorUserId: string,
  requestNumber?: string,
): Promise<void> {
  try {
    let reqNum = requestNumber
    if (!reqNum) {
      const ctx = await getContractRequestContext(contractRequestId)
      reqNum = ctx?.requestNumber
    }
    if (!reqNum) return

    const recipients = await getOmtsRecipientsForSite(siteId, actorUserId)
    await insertNotifications(recipients, {
      type: 'new_request_pending',
      title: 'Новая заявка на договор',
      message: `Заявка на договор №${reqNum} поступила на согласование`,
      contractRequestId,
      siteId,
      departmentId: 'omts',
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка уведомления о новой заявке на договор', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'notifyContractNewRequest', contractRequestId } })
  }
}

/** Уведомление контрагенту о смене статуса заявки на договор */
export async function notifyContractStatusChanged(
  contractRequestId: string,
  statusLabel: string,
  actorUserId: string,
): Promise<void> {
  try {
    const ctx = await getContractRequestContext(contractRequestId)
    if (!ctx) return
    const recipients = await getCounterpartyRecipients(ctx.counterpartyId, actorUserId)
    await insertNotifications(recipients, {
      type: 'status_changed',
      title: 'Изменение статуса договора',
      message: `Заявка на договор №${ctx.requestNumber}: статус изменён на «${statusLabel}»`,
      contractRequestId,
      siteId: ctx.siteId,
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка уведомления о статусе договора', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'notifyContractStatusChanged', contractRequestId } })
  }
}

/** Уведомление при отправке заявки на доработку */
export async function notifyContractRevision(
  contractRequestId: string,
  targets: RevisionTarget[],
  actorUserId: string,
): Promise<void> {
  try {
    const ctx = await getContractRequestContext(contractRequestId)
    if (!ctx) return

    const allRecipients = new Set<string>()

    if (targets.includes('shtab')) {
      const shtabUsers = await getShtabRecipientsForSite(ctx.siteId, actorUserId)
      shtabUsers.forEach((id) => allRecipients.add(id))
    }

    if (targets.includes('counterparty')) {
      const counterpartyUsers = await getCounterpartyRecipients(ctx.counterpartyId, actorUserId)
      counterpartyUsers.forEach((id) => allRecipients.add(id))
    }

    await insertNotifications([...allRecipients], {
      type: 'status_changed',
      title: 'Заявка на договор отправлена на доработку',
      message: `Заявка на договор №${ctx.requestNumber} отправлена на доработку`,
      contractRequestId,
      siteId: ctx.siteId,
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка уведомления о доработке договора', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'notifyContractRevision', contractRequestId } })
  }
}

/** Уведомление о новом комментарии в заявке на договор */
export async function notifyContractNewComment(
  contractRequestId: string,
  actorUserId: string,
  recipient?: string | null,
): Promise<void> {
  try {
    const ctx = await getContractRequestContext(contractRequestId)
    if (!ctx) return

    const allRecipients = new Set<string>()

    if (recipient === 'shtab') {
      const shtabUsers = await getShtabRecipientsForSite(ctx.siteId, actorUserId)
      shtabUsers.forEach((id) => allRecipients.add(id))
    } else if (recipient === 'omts') {
      const omtsUsers = await getOmtsRecipientsForSite(ctx.siteId, actorUserId)
      omtsUsers.forEach((id) => allRecipients.add(id))
    } else if (recipient === 'counterparty') {
      const counterpartyUsers = await getCounterpartyRecipients(ctx.counterpartyId, actorUserId)
      counterpartyUsers.forEach((id) => allRecipients.add(id))
    } else {
      // Всем участникам
      const counterpartyUsers = await getCounterpartyRecipients(ctx.counterpartyId, actorUserId)
      counterpartyUsers.forEach((id) => allRecipients.add(id))
      const omtsUsers = await getOmtsRecipientsForSite(ctx.siteId, actorUserId)
      omtsUsers.forEach((id) => allRecipients.add(id))
      const shtabUsers = await getShtabRecipientsForSite(ctx.siteId, actorUserId)
      shtabUsers.forEach((id) => allRecipients.add(id))
    }

    await insertNotifications([...allRecipients], {
      type: 'new_comment',
      title: 'Новый комментарий к договору',
      message: `Новый комментарий в заявке на договор №${ctx.requestNumber}`,
      contractRequestId,
      siteId: ctx.siteId,
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка уведомления о комментарии к договору', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'notifyContractNewComment', contractRequestId } })
  }
}

/** Уведомление о новых файлах в заявке на договор */
export async function notifyContractNewFile(
  contractRequestId: string,
  actorUserId: string,
): Promise<void> {
  try {
    const ctx = await getContractRequestContext(contractRequestId)
    if (!ctx) return

    const allRecipients = new Set<string>()

    // Контрагент — всегда получает
    const counterpartyUsers = await getCounterpartyRecipients(ctx.counterpartyId, actorUserId)
    counterpartyUsers.forEach((id) => allRecipients.add(id))

    // ОМТС для объекта
    const omtsUsers = await getOmtsRecipientsForSite(ctx.siteId, actorUserId)
    omtsUsers.forEach((id) => allRecipients.add(id))

    await insertNotifications([...allRecipients], {
      type: 'new_file',
      title: 'Новые файлы к договору',
      message: `Новые файлы в заявке на договор №${ctx.requestNumber}`,
      contractRequestId,
      siteId: ctx.siteId,
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка уведомления о файлах договора', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'notifyContractNewFile', contractRequestId } })
  }
}
