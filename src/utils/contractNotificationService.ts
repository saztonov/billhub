import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import type { RevisionTarget } from '@/types'

// --- Экспортируемые функции уведомлений ---
// Вся логика определения получателей теперь на бэкенде.

/** Уведомление ОМТС о новой заявке на согласование договора */
export async function notifyContractNewRequest(
  contractRequestId: string,
  siteId: string,
  actorUserId: string,
  requestNumber?: string,
): Promise<void> {
  try {
    await api.post('/api/notifications/contract-request/new-request', {
      contractRequestId,
      siteId,
      actorUserId,
      requestNumber,
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
    await api.post('/api/notifications/contract-request/status-changed', {
      contractRequestId,
      statusLabel,
      actorUserId,
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
    await api.post('/api/notifications/contract-request/revision', {
      contractRequestId,
      targets,
      actorUserId,
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
    await api.post('/api/notifications/contract-request/new-comment', {
      contractRequestId,
      actorUserId,
      recipient: recipient ?? null,
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
    await api.post('/api/notifications/contract-request/new-file', {
      contractRequestId,
      actorUserId,
    })
  } catch (err) {
    logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка уведомления о файлах договора', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'notifyContractNewFile', contractRequestId } })
  }
}
