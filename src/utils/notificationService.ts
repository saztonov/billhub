import { supabase } from '@/services/supabase'
import { logError } from '@/services/errorLogger'
import { DEPARTMENT_LABELS, type Department } from '@/types'

// --- Внутренние функции определения получателей ---

/** Контекст заявки для формирования уведомлений */
interface RequestContext {
  requestNumber: string
  counterpartyId: string
  siteId: string
  currentStage: number | null
  statusCode: string | null
}

/** Загружает контекст заявки */
async function getRequestContext(paymentRequestId: string): Promise<RequestContext | null> {
  const { data } = await supabase
    .from('payment_requests')
    .select('request_number, counterparty_id, site_id, current_stage, statuses(code)')
    .eq('id', paymentRequestId)
    .single()
  if (!data) return null
  const statusObj = data.statuses as unknown as { code: string } | null
  return {
    requestNumber: data.request_number as string,
    counterpartyId: data.counterparty_id as string,
    siteId: data.site_id as string,
    currentStage: (data.current_stage as number) ?? null,
    statusCode: statusObj?.code ?? null,
  }
}

/** Получает id всех активных counterparty_user контрагента (кроме excludeUserId) */
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

/** Получает id Штаб-сотрудников с доступом к объекту (кроме excludeUserId) */
async function getShtabRecipientsForSite(siteId: string, excludeUserId?: string): Promise<string[]> {
  // Все активные admin/user с department_id='shtab'
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
    // Проверяем привязку к объекту
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

/** Получает id админов ОМТС (role='admin', department_id='omts', is_active=true, кроме excludeUserId) */
async function getOmtsAdminRecipients(excludeUserId?: string): Promise<string[]> {
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .eq('department_id', 'omts')
    .eq('is_active', true)
  if (!data) return []
  return (data as { id: string }[])
    .map((u) => u.id)
    .filter((id) => id !== excludeUserId)
}

/** Получает id спец. лица ОМТС РП из настроек (кроме excludeUserId) */
async function getOmtsRpResponsibleUser(excludeUserId?: string): Promise<string | null> {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'omts_rp_config')
    .maybeSingle()
  if (!data) return null
  const config = data.value as { responsible_user_id?: string } | null
  const userId = config?.responsible_user_id ?? null
  if (!userId || userId === excludeUserId) return null
  return userId
}

/** Получает id назначенного ОМТС-ответственного на заявку (кроме excludeUserId) */
async function getOmtsAssignedUser(paymentRequestId: string, excludeUserId?: string): Promise<string | null> {
  const { data } = await supabase
    .from('payment_request_assignments')
    .select('assigned_user_id')
    .eq('payment_request_id', paymentRequestId)
    .eq('is_current', true)
    .maybeSingle()
  if (!data) return null
  const assignedId = data.assigned_user_id as string
  if (assignedId === excludeUserId) return null
  return assignedId
}

/** Массовая вставка уведомлений */
async function insertNotifications(
  recipientIds: string[],
  data: {
    type: string
    title: string
    message: string
    paymentRequestId: string
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
    payment_request_id: data.paymentRequestId,
    site_id: data.siteId ?? null,
    department_id: data.departmentId ?? null,
  }))
  await supabase.from('notifications').insert(rows)
}

// --- Экспортируемые функции уведомлений ---

/**
 * Уведомление контрагенту о финальном статусе заявки.
 * Вызывается при: финальном согласовании, отклонении, отправке на доработку.
 */
export async function notifyStatusChanged(
  paymentRequestId: string,
  statusLabel: string,
  actorUserId: string,
): Promise<void> {
  try {
    const ctx = await getRequestContext(paymentRequestId)
    if (!ctx) return
    const recipients = await getCounterpartyRecipients(ctx.counterpartyId, actorUserId)
    await insertNotifications(recipients, {
      type: 'status_changed',
      title: 'Изменение статуса заявки',
      message: `Заявка №${ctx.requestNumber}: статус изменён на «${statusLabel}»`,
      paymentRequestId,
      siteId: ctx.siteId,
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка уведомления о статусе', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'notifyStatusChanged', paymentRequestId } })
  }
}

/**
 * Уведомление Штабу о новой заявке на согласовании.
 * Вызывается при: создании заявки, повторной отправке.
 */
export async function notifyNewRequestPending(
  paymentRequestId: string,
  siteId: string,
  actorUserId: string,
  requestNumber?: string,
): Promise<void> {
  try {
    let reqNum = requestNumber
    if (!reqNum) {
      const ctx = await getRequestContext(paymentRequestId)
      reqNum = ctx?.requestNumber
    }
    if (!reqNum) return

    const recipients = await getShtabRecipientsForSite(siteId, actorUserId)
    await insertNotifications(recipients, {
      type: 'new_request_pending',
      title: 'Новая заявка на согласование',
      message: `Заявка №${reqNum} поступила на согласование`,
      paymentRequestId,
      siteId,
      departmentId: 'shtab',
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка уведомления о новой заявке', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'notifyNewRequestPending', paymentRequestId } })
  }
}

/**
 * Уведомление спец. лицу ОМТС РП о поступлении заявки на согласование.
 * Вызывается при: смене статуса на approv_omts_rp.
 */
export async function notifyOmtsRpPending(
  paymentRequestId: string,
  actorUserId: string,
): Promise<void> {
  try {
    const ctx = await getRequestContext(paymentRequestId)
    if (!ctx) return
    const responsibleUserId = await getOmtsRpResponsibleUser(actorUserId)
    if (!responsibleUserId) return
    await insertNotifications([responsibleUserId], {
      type: 'new_request_pending',
      title: 'Новая заявка на согласование ОМТС РП',
      message: `Заявка №${ctx.requestNumber} поступила на согласование ОМТС РП`,
      paymentRequestId,
      siteId: ctx.siteId,
      departmentId: 'omts',
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка уведомления ОМТС РП', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'notifyOmtsRpPending', paymentRequestId } })
  }
}

/**
 * Уведомление назначенному ОМТС-сотруднику.
 * Вызывается при: назначении ответственного.
 */
export async function notifyRequestAssigned(
  paymentRequestId: string,
  assignedUserId: string,
  actorUserId: string,
): Promise<void> {
  try {
    if (assignedUserId === actorUserId) return
    const ctx = await getRequestContext(paymentRequestId)
    if (!ctx) return
    await insertNotifications([assignedUserId], {
      type: 'request_assigned',
      title: 'Назначена заявка',
      message: `Заявка №${ctx.requestNumber} назначена вам`,
      paymentRequestId,
      siteId: ctx.siteId,
      departmentId: 'omts',
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка уведомления о назначении', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'notifyRequestAssigned', paymentRequestId } })
  }
}

/**
 * Уведомление о новом комментарии.
 * Определяет получателей по current_stage заявки.
 */
export async function notifyNewComment(
  paymentRequestId: string,
  actorUserId: string,
  recipient?: string | null,
): Promise<void> {
  try {
    const ctx = await getRequestContext(paymentRequestId)
    if (!ctx) return

    const allRecipients = new Set<string>()

    // Подрядчик — всегда получает уведомление
    const counterpartyUsers = await getCounterpartyRecipients(ctx.counterpartyId, actorUserId)
    counterpartyUsers.forEach((id) => allRecipients.add(id))

    if (recipient === 'shtab') {
      // Адресат Штаб — уведомляем Штаб на любом этапе
      const shtabUsers = await getShtabRecipientsForSite(ctx.siteId, actorUserId)
      shtabUsers.forEach((id) => allRecipients.add(id))
    } else if (recipient === 'omts') {
      // Адресат ОМТС — уведомляем назначенного ответственного + админов ОМТС на любом этапе
      const omtsUser = await getOmtsAssignedUser(paymentRequestId, actorUserId)
      if (omtsUser) allRecipients.add(omtsUser)
      const omtsAdmins = await getOmtsAdminRecipients(actorUserId)
      omtsAdmins.forEach((id) => allRecipients.add(id))
    } else if (recipient === 'counterparty') {
      // Адресат Подрядчик — только подрядчик (уже добавлен выше)
    } else {
      // Всем — текущая логика по этапу
      if (ctx.currentStage === 1) {
        const shtabUsers = await getShtabRecipientsForSite(ctx.siteId, actorUserId)
        shtabUsers.forEach((id) => allRecipients.add(id))
      }
      if (ctx.currentStage === 2) {
        const omtsUser = await getOmtsAssignedUser(paymentRequestId, actorUserId)
        if (omtsUser) allRecipients.add(omtsUser)
        // На этапе ОМТС РП уведомляем также спец. лицо
        if (ctx.statusCode === 'approv_omts_rp') {
          const omtsRpUser = await getOmtsRpResponsibleUser(actorUserId)
          if (omtsRpUser) allRecipients.add(omtsRpUser)
        }
      }
    }

    await insertNotifications([...allRecipients], {
      type: 'new_comment',
      title: 'Новый комментарий',
      message: `Новый комментарий в заявке №${ctx.requestNumber}`,
      paymentRequestId,
      siteId: ctx.siteId,
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка уведомления о комментарии', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'notifyNewComment', paymentRequestId } })
  }
}

/**
 * Уведомление о новых файлах.
 * Определяет получателей по current_stage заявки.
 */
export async function notifyNewFile(
  paymentRequestId: string,
  actorUserId: string,
): Promise<void> {
  try {
    const ctx = await getRequestContext(paymentRequestId)
    if (!ctx) return

    const allRecipients = new Set<string>()

    // Контрагент — всегда получает уведомление
    const counterpartyUsers = await getCounterpartyRecipients(ctx.counterpartyId, actorUserId)
    counterpartyUsers.forEach((id) => allRecipients.add(id))

    // Штаб — только на этапе 1
    if (ctx.currentStage === 1) {
      const shtabUsers = await getShtabRecipientsForSite(ctx.siteId, actorUserId)
      shtabUsers.forEach((id) => allRecipients.add(id))
    }

    // ОМТС — только на этапе 2, только назначенный на эту заявку
    if (ctx.currentStage === 2) {
      const omtsUser = await getOmtsAssignedUser(paymentRequestId, actorUserId)
      if (omtsUser) allRecipients.add(omtsUser)
      // На этапе ОМТС РП уведомляем также спец. лицо
      if (ctx.statusCode === 'approv_omts_rp') {
        const omtsRpUser = await getOmtsRpResponsibleUser(actorUserId)
        if (omtsRpUser) allRecipients.add(omtsRpUser)
      }
    }

    await insertNotifications([...allRecipients], {
      type: 'new_file',
      title: 'Новые файлы',
      message: `Новые файлы в заявке №${ctx.requestNumber}`,
      paymentRequestId,
      siteId: ctx.siteId,
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка уведомления о файлах', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'notifyNewFile', paymentRequestId } })
  }
}

/**
 * Проверяет наличие специалиста подразделения для объекта
 * и создаёт уведомления при отсутствии (только для админов).
 */
export async function checkAndNotifyMissingSpecialists(
  paymentRequestId: string,
  siteId: string,
  department: Department,
): Promise<void> {
  try {
    // Загружаем данные заявки
    const { data: prData } = await supabase
      .from('payment_requests')
      .select('request_number, construction_sites(name)')
      .eq('id', paymentRequestId)
      .single()
    if (!prData) return

    const siteObj = prData.construction_sites as unknown as { name: string } | null
    const siteName = siteObj?.name ?? 'Не указан'
    const requestNumber = prData.request_number as string

    // Ищем пользователей подразделения для объекта
    const { data: deptUsers } = await supabase
      .from('users')
      .select('id, all_sites')
      .eq('department_id', department)
      .eq('is_active', true)
      .in('role', ['admin', 'user'])

    let hasSpecialist = false
    if (deptUsers && deptUsers.length > 0) {
      for (const u of deptUsers) {
        if (u.all_sites) {
          hasSpecialist = true
          break
        }
        const { data: siteMapping } = await supabase
          .from('user_construction_sites_mapping')
          .select('id')
          .eq('user_id', u.id)
          .eq('construction_site_id', siteId)
          .limit(1)
        if (siteMapping && siteMapping.length > 0) {
          hasSpecialist = true
          break
        }
      }
    }

    if (!hasSpecialist) {
      // Дедупликация
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('type', 'missing_specialist')
        .eq('payment_request_id', paymentRequestId)
        .eq('department_id', department)
        .eq('site_id', siteId)
        .eq('resolved', false)
        .limit(1)
      if (existing && existing.length > 0) return

      const deptName = DEPARTMENT_LABELS[department]

      // Рассылка только админам
      const { data: recipients } = await supabase
        .from('users')
        .select('id')
        .eq('is_active', true)
        .eq('role', 'admin')

      const notifications = (recipients ?? []).map((r: Record<string, unknown>) => ({
        type: 'missing_specialist',
        title: 'Отсутствует специалист для согласования',
        message: `Заявка №${requestNumber}: подразделение "${deptName}" не имеет специалиста для объекта "${siteName}"`,
        user_id: r.id as string,
        payment_request_id: paymentRequestId,
        department_id: department,
        site_id: siteId,
      }))
      if (notifications.length > 0) {
        await supabase.from('notifications').insert(notifications)
      }
    }
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка проверки специалистов', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'checkAndNotifyMissingSpecialists', paymentRequestId } })
  }
}
