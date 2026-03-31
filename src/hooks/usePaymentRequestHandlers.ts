import { useCallback } from 'react'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import { notifyRequestResubmitted } from '@/utils/notificationService'
import type { EditRequestData } from '@/store/paymentRequestStore'
import type { FileItem } from '@/components/paymentRequests/FileUploadList'
import type { PaymentRequest, Department, Counterparty } from '@/types'

/** Минимальный набор данных пользователя для обработчиков */
interface UserInfo {
  id?: string
  counterpartyId?: string | null
  department?: Department | null
}

/** Функции сторов, необходимые обработчикам */
interface StoreFunctions {
  fetchRequests: (counterpartyId?: string, siteIds?: string[], allSites?: boolean, showDeleted?: boolean) => void
  fetchCounterparties: () => Promise<void>
  fetchPendingRequests: (department: string, userId: string, isAdmin: boolean) => void
  fetchOmtsRpPendingRequests: () => void
  fetchApprovedCount: (siteIds?: string[], allSites?: boolean) => void
  fetchRejectedCount: (siteIds?: string[], allSites?: boolean) => void
  approveRequest: (requestId: string, department: string, userId: string, comment: string) => Promise<void>
  rejectRequest: (requestId: string, department: string, userId: string, comment: string, files?: { id: string; file: File }[]) => Promise<void>
  deleteRequest: (id: string) => Promise<void>
  withdrawRequest: (id: string, comment?: string) => Promise<void>
  resubmitRequest: (id: string, comment: string, counterpartyId: string, userId: string, fieldUpdates: {
    deliveryDays: number
    deliveryDaysType: string
    shippingConditionId: string
    invoiceAmount: number
  }) => Promise<void>
  updateRequest: (id: string, data: EditRequestData, userId: string, filesCount?: number) => Promise<void>
  assignResponsible: (requestId: string, userId: string, assignedBy: string) => Promise<void>
  siteFilterParams: () => [string[]?, boolean?]
}

/** UI-сеттеры для обработчиков */
interface UISetters {
  setViewRecord: (record: PaymentRequest | null) => void
  setResubmitRecord: (record: PaymentRequest | null) => void
}

/** Роли и флаги пользователя */
interface RoleFlags {
  isUser: boolean
  isAdmin: boolean
  isCounterpartyUser: boolean
  isOmtsRpUser: boolean
  adminSelectedStage: Department
}

/** Контекстные данные */
interface ContextData {
  requests: PaymentRequest[]
  counterparties: Counterparty[]
  resubmitRecord: PaymentRequest | null
}

interface MessageApi {
  success: (content: string) => void
  error: (content: string) => void
}

export interface UsePaymentRequestHandlersParams {
  user: UserInfo | null
  message: MessageApi
  storeFunctions: StoreFunctions
  uiSetters: UISetters
  roleFlags: RoleFlags
  contextData: ContextData
}

/**
 * Хук с обработчиками действий над заявками.
 * Объединяет логику согласования, редактирования, удаления и повторной отправки.
 */
export function usePaymentRequestHandlers({
  user,
  message,
  storeFunctions,
  uiSetters,
  roleFlags,
  contextData,
}: UsePaymentRequestHandlersParams) {
  const {
    fetchRequests, fetchCounterparties, fetchPendingRequests,
    fetchOmtsRpPendingRequests, fetchApprovedCount, fetchRejectedCount,
    approveRequest, rejectRequest, deleteRequest, withdrawRequest,
    resubmitRequest, updateRequest, assignResponsible, siteFilterParams,
  } = storeFunctions

  const { setViewRecord, setResubmitRecord } = uiSetters
  const { isUser, isAdmin, isCounterpartyUser, isOmtsRpUser, adminSelectedStage } = roleFlags
  const { requests, counterparties, resubmitRecord } = contextData

  // Обновить заявку (редактирование + загрузка файлов)
  const handleEdit = async (id: string, data: EditRequestData, files: FileItem[]) => {
    if (!user?.id) return
    try {
      await updateRequest(id, data, user.id)

      if (files.length > 0) {
        const req = requests.find((r) => r.id === id)
        if (req) {
          if (counterparties.length === 0) await fetchCounterparties()
          const cp = useCounterpartyStore.getState().counterparties.find((c) => c.id === req.counterpartyId)
          if (cp) {
            useUploadQueueStore.getState().addTask({
              type: 'request_files',
              requestId: id,
              requestNumber: req.requestNumber,
              counterpartyName: cp.name,
              files: files.map((f) => ({
                file: f.file,
                documentTypeId: f.documentTypeId!,
                pageCount: f.pageCount,
                isAdditional: true,
              })),
              userId: user.id,
            })
          }
        }
      }

      message.success('Заявка обновлена')
      setViewRecord(null)
      const [sIds, allS] = siteFilterParams()
      if (isUser) fetchRequests(undefined, sIds, allS)
      else fetchRequests()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка обновления')
    }
  }

  // Отозвать заявку
  const handleWithdraw = async (id: string, comment: string) => {
    await withdrawRequest(id, comment || undefined)
    message.success('Заявка отозвана')
    if (isCounterpartyUser && user?.counterpartyId) fetchRequests(user.counterpartyId)
  }

  // Удалить заявку (мягкое удаление)
  const handleDelete = async (id: string) => {
    await deleteRequest(id)
    message.success('Заявка перемещена в удаленные')
  }

  // Вспомогательная функция обновления списков после согласования/отклонения
  const refreshAfterApproval = () => {
    const department = isAdmin ? adminSelectedStage : user?.department
    if (department && user?.id) fetchPendingRequests(department, user.id, isAdmin)
    if (isOmtsRpUser || isAdmin) fetchOmtsRpPendingRequests()
    const [sIds, allS] = siteFilterParams()
    if (isUser) fetchRequests(undefined, sIds, allS)
    else fetchRequests()
    fetchApprovedCount(sIds, allS)
    fetchRejectedCount(sIds, allS)
  }

  // Согласовать заявку
  const handleApprove = async (requestId: string, comment: string) => {
    if (!user?.id) return
    const department = isAdmin ? adminSelectedStage : user?.department
    if (!department) return
    await approveRequest(requestId, department, user.id, comment)
    message.success('Заявка согласована')
    refreshAfterApproval()
  }

  // Отклонить заявку
  const handleReject = async (requestId: string, comment: string, files?: { id: string; file: File }[]) => {
    if (!user?.id) return
    const department = isAdmin ? adminSelectedStage : user?.department
    if (!department) return
    await rejectRequest(requestId, department, user.id, comment, files)
    message.success('Заявка отклонена')
    refreshAfterApproval()
  }

  // Назначить ответственного
  const handleAssignResponsible = useCallback(async (requestId: string, userId: string) => {
    if (!user?.id) return
    try {
      await assignResponsible(requestId, userId, user.id)
      message.success('Ответственный назначен')
      const [sIds, allS] = siteFilterParams()
      if (isUser) fetchRequests(undefined, sIds, allS)
      else fetchRequests()
    } catch {
      message.error('Ошибка назначения')
    }
  }, [user?.id, assignResponsible, isUser, siteFilterParams, fetchRequests, message])

  // Повторная отправка заявки (контрагент)
  const handleResubmit = async (comment: string, files: FileItem[], fieldUpdates: {
    deliveryDays: number
    deliveryDaysType: string
    shippingConditionId: string
    invoiceAmount: number
  }) => {
    if (!resubmitRecord || !user?.counterpartyId || !user?.id) return
    try {
      await resubmitRequest(resubmitRecord.id, comment, user.counterpartyId, user.id, fieldUpdates, files.length)

      // Уведомление Штабу (и ОМТС при отклонении на их этапе) о повторной отправке
      notifyRequestResubmitted(resubmitRecord.id, user.id, resubmitRecord.rejectedStage ?? null).catch(() => {})

      if (files.length > 0) {
        if (counterparties.length === 0) await fetchCounterparties()
        const cp = useCounterpartyStore.getState().counterparties.find((c) => c.id === user.counterpartyId)
        if (cp) {
          useUploadQueueStore.getState().addTask({
            type: 'request_files',
            requestId: resubmitRecord.id,
            requestNumber: resubmitRecord.requestNumber,
            counterpartyName: cp.name,
            files: files.map((f) => ({
              file: f.file,
              documentTypeId: f.documentTypeId!,
              pageCount: f.pageCount,
              isResubmit: true,
            })),
            userId: user.id,
          })
        }
      }

      message.success('Заявка отправлена повторно')
      setResubmitRecord(null)
      fetchRequests(user.counterpartyId)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка повторной отправки')
    }
  }

  return {
    handleEdit,
    handleWithdraw,
    handleDelete,
    handleApprove,
    handleReject,
    handleAssignResponsible,
    handleResubmit,
  }
}
