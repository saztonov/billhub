import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import type { Department } from '@/types'

// --- Экспортируемые функции уведомлений ---
// Вся логика определения получателей теперь на бэкенде.

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
    await api.post('/api/notifications/payment-request/status-changed', {
      paymentRequestId,
      statusLabel,
      actorUserId,
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
    await api.post('/api/notifications/payment-request/new-pending', {
      paymentRequestId,
      siteId,
      actorUserId,
      requestNumber,
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка уведомления о новой заявке', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'notifyNewRequestPending', paymentRequestId } })
  }
}

/**
 * Уведомление Штабу (и ОМТС при отклонении на их этапе) о повторной отправке заявки.
 * Вызывается при: повторной отправке отклонённой заявки контрагентом.
 */
export async function notifyRequestResubmitted(
  paymentRequestId: string,
  actorUserId: string,
  rejectedStage: number | null,
): Promise<void> {
  try {
    await api.post('/api/notifications/payment-request/resubmitted', {
      paymentRequestId,
      actorUserId,
      rejectedStage,
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка уведомления о повторной отправке', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'notifyRequestResubmitted', paymentRequestId } })
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
    await api.post('/api/notifications/payment-request/omts-rp-pending', {
      paymentRequestId,
      actorUserId,
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
    await api.post('/api/notifications/payment-request/assigned', {
      paymentRequestId,
      assignedUserId,
      actorUserId,
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
    await api.post('/api/notifications/payment-request/new-comment', {
      paymentRequestId,
      actorUserId,
      recipient: recipient ?? null,
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
    await api.post('/api/notifications/payment-request/new-file', {
      paymentRequestId,
      actorUserId,
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
    await api.post('/api/notifications/payment-request/check-specialists', {
      paymentRequestId,
      siteId,
      department,
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка проверки специалистов', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'checkAndNotifyMissingSpecialists', paymentRequestId } })
  }
}
