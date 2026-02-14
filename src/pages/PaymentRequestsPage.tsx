import { useEffect, useMemo, useState, useCallback } from 'react'
import { Typography, Button, Tabs, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import type { EditRequestData } from '@/store/paymentRequestStore'
import { useAuthStore } from '@/store/authStore'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import { useApprovalStore } from '@/store/approvalStore'
import { supabase } from '@/services/supabase'
import CreateRequestModal from '@/components/paymentRequests/CreateRequestModal'
import ViewRequestModal from '@/components/paymentRequests/ViewRequestModal'
import RequestsTable from '@/components/paymentRequests/RequestsTable'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import type { FileItem } from '@/components/paymentRequests/FileUploadList'
import type { PaymentRequest } from '@/types'

const { Title } = Typography

/** Загрузить объекты пользователя из БД */
async function loadUserSiteIds(userId: string): Promise<{ allSites: boolean; siteIds: string[] }> {
  const { data: userData } = await supabase
    .from('users')
    .select('all_sites')
    .eq('id', userId)
    .single()
  const allSites = (userData?.all_sites as boolean) ?? false
  if (allSites) return { allSites: true, siteIds: [] }

  const { data: mappings } = await supabase
    .from('user_construction_sites_mapping')
    .select('construction_site_id')
    .eq('user_id', userId)
  const siteIds = (mappings ?? []).map((m: Record<string, unknown>) => m.construction_site_id as string)
  return { allSites: false, siteIds }
}

const PaymentRequestsPage = () => {
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [viewRecord, setViewRecord] = useState<PaymentRequest | null>(null)
  const [resubmitRecord, setResubmitRecord] = useState<PaymentRequest | null>(null)
  const [activeTab, setActiveTab] = useState('all')
  const [userSiteIds, setUserSiteIds] = useState<string[]>([])
  const [userAllSites, setUserAllSites] = useState(true)
  const [sitesLoaded, setSitesLoaded] = useState(false)
  // ID контрагентов, за которых отвечает текущий user (responsible_user_id)
  const [responsibleCounterpartyIds, setResponsibleCounterpartyIds] = useState<string[]>([])

  const user = useAuthStore((s) => s.user)
  const isCounterpartyUser = user?.role === 'counterparty_user'
  const isAdmin = user?.role === 'admin'
  const isUser = user?.role === 'user'

  const {
    requests,
    isLoading,
    fetchRequests,
    deleteRequest,
    withdrawRequest,
    resubmitRequest,
    updateRequest,
  } = usePaymentRequestStore()

  const { counterparties, fetchCounterparties } = useCounterpartyStore()

  const retryTask = useUploadQueueStore((s) => s.retryTask)
  const uploadTasks = useUploadQueueStore((s) => s.tasks)

  const {
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    isLoading: approvalLoading,
    fetchPendingRequests,
    fetchApprovedRequests,
    fetchRejectedRequests,
    approveRequest,
    rejectRequest,
  } = useApprovalStore()

  // Загружаем объекты пользователя для role=user
  useEffect(() => {
    if (!user?.id || !isUser) {
      setSitesLoaded(true)
      return
    }
    loadUserSiteIds(user.id).then(({ allSites, siteIds }) => {
      setUserAllSites(allSites)
      setUserSiteIds(siteIds)
      setSitesLoaded(true)
    })
  }, [user?.id, isUser])

  // Загружаем контрагентов, за которых отвечает user (для определения canEdit)
  useEffect(() => {
    if (!user?.id || isCounterpartyUser) return
    if (isAdmin || isUser) {
      supabase
        .from('counterparties')
        .select('id')
        .eq('responsible_user_id', user.id)
        .then(({ data }) => {
          setResponsibleCounterpartyIds((data ?? []).map((r: Record<string, unknown>) => r.id as string))
        })
    }
  }, [user?.id, isAdmin, isUser, isCounterpartyUser])

  // Общее количество уникальных этапов согласования (жесткая цепочка: Штаб → ОМТС)
  const totalStages = 2

  // Проверяем, участвует ли подразделение пользователя в цепочке (только Штаб и ОМТС)
  const userDeptInChain = useMemo(() => {
    if (!user?.department) return false
    return user.department === 'shtab' || user.department === 'omts'
  }, [user?.department])

  // Параметры фильтрации для role=user
  const siteFilterParams = useCallback((): [string[]?, boolean?] => {
    if (!isUser) return [undefined, undefined]
    return [userSiteIds, userAllSites]
  }, [isUser, userSiteIds, userAllSites])

  useEffect(() => {
    if (!sitesLoaded) return
    if (isCounterpartyUser && user?.counterpartyId) {
      fetchRequests(user.counterpartyId)
    } else if (isAdmin) {
      fetchRequests()
    } else if (isUser) {
      fetchRequests(undefined, userSiteIds, userAllSites)
    }
  }, [fetchRequests, isCounterpartyUser, isAdmin, isUser, user?.counterpartyId, sitesLoaded, userSiteIds, userAllSites])

  // Загружаем данные при переключении вкладок
  useEffect(() => {
    if (isCounterpartyUser || !sitesLoaded) return
    const [sIds, allS] = siteFilterParams()
    if (activeTab === 'pending' && user?.department && user?.id) {
      fetchPendingRequests(user.department, user.id)
    } else if (activeTab === 'approved') {
      fetchApprovedRequests(sIds, allS)
    } else if (activeTab === 'rejected') {
      fetchRejectedRequests(sIds, allS)
    }
  }, [activeTab, isCounterpartyUser, user?.department, user?.id, sitesLoaded, siteFilterParams, fetchPendingRequests, fetchApprovedRequests, fetchRejectedRequests])

  /** Проверяет, может ли текущий пользователь редактировать заявку */
  const canEditRequest = useCallback((record: PaymentRequest | null): boolean => {
    if (!record || isCounterpartyUser) return false
    if (isAdmin) return true
    if (isUser && responsibleCounterpartyIds.includes(record.counterpartyId)) return true
    return false
  }, [isAdmin, isUser, isCounterpartyUser, responsibleCounterpartyIds])

  /** Обработчик сохранения редактирования */
  const handleEdit = async (id: string, data: EditRequestData, files: FileItem[]) => {
    if (!user?.id) return
    try {
      await updateRequest(id, data, user.id, files.length > 0 ? files.length : undefined)

      // Если есть новые файлы — загружаем через очередь
      if (files.length > 0) {
        // Находим заявку для получения данных
        const req = requests.find((r) => r.id === id)
        if (req) {
          if (counterparties.length === 0) await fetchCounterparties()
          const cp = useCounterpartyStore.getState().counterparties.find((c) => c.id === req.counterpartyId)
          if (cp) {
            const addUploadTask = useUploadQueueStore.getState().addTask
            addUploadTask({
              requestId: id,
              requestNumber: req.requestNumber,
              counterpartyName: cp.name,
              files: files.map((f) => ({
                file: f.file,
                documentTypeId: f.documentTypeId!,
                pageCount: f.pageCount,
              })),
              userId: user.id,
            })
          }
        }
      }

      message.success('Заявка обновлена')
      setViewRecord(null)
      // Обновляем список
      const [sIds, allS] = siteFilterParams()
      if (isUser) {
        fetchRequests(undefined, sIds, allS)
      } else {
        fetchRequests()
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Ошибка обновления'
      message.error(errorMsg)
    }
  }

  const handleWithdraw = async (id: string, comment: string) => {
    await withdrawRequest(id, comment || undefined)
    message.success('Заявка отозвана')
    if (isCounterpartyUser && user?.counterpartyId) {
      fetchRequests(user.counterpartyId)
    }
  }

  const handleDelete = async (id: string) => {
    await deleteRequest(id)
    message.success('Заявка удалена')
  }

  const handleApprove = async (requestId: string, comment: string) => {
    if (!user?.department || !user?.id) return
    await approveRequest(requestId, user.department, user.id, comment)
    message.success('Заявка согласована')
    fetchPendingRequests(user.department, user.id)
    const [sIds, allS] = siteFilterParams()
    if (isUser) {
      fetchRequests(undefined, sIds, allS)
    } else {
      fetchRequests()
    }
  }

  const handleReject = async (requestId: string, comment: string) => {
    if (!user?.department || !user?.id) return
    await rejectRequest(requestId, user.department, user.id, comment)
    message.success('Заявка отклонена')
    fetchPendingRequests(user.department, user.id)
    const [sIds, allS] = siteFilterParams()
    if (isUser) {
      fetchRequests(undefined, sIds, allS)
    } else {
      fetchRequests()
    }
  }

  const handleResubmit = async (comment: string, files: FileItem[]) => {
    if (!resubmitRecord || !user?.counterpartyId || !user?.id) return
    try {
      // Повторная отправка заявки
      await resubmitRequest(resubmitRecord.id, comment, user.counterpartyId)

      // Если есть новые файлы — загружаем через очередь
      if (files.length > 0) {
        // Загружаем контрагентов для имени, если ещё не загружены
        if (counterparties.length === 0) await fetchCounterparties()
        const cp = useCounterpartyStore.getState().counterparties.find((c) => c.id === user.counterpartyId)
        if (cp) {
          // Обновляем total_files
          const { error } = await supabase
            .from('payment_requests')
            .update({ total_files: resubmitRecord.totalFiles + files.length })
            .eq('id', resubmitRecord.id)
          if (!error) {
            const addUploadTask = useUploadQueueStore.getState().addTask
            addUploadTask({
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
      }

      message.success('Заявка отправлена повторно')
      setResubmitRecord(null)
      fetchRequests(user.counterpartyId)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Ошибка повторной отправки'
      message.error(errorMsg)
    }
  }

  // Для counterparty_user — без вкладок
  if (isCounterpartyUser) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={2} style={{ margin: 0 }}>Заявки на оплату</Title>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateOpen(true)}>
            Добавить
          </Button>
        </div>
        <RequestsTable
          requests={requests}
          isLoading={isLoading}
          onView={setViewRecord}
          isCounterpartyUser
          onWithdraw={handleWithdraw}
          onResubmit={setResubmitRecord}
          uploadTasks={uploadTasks}
          onRetryUpload={retryTask}
          totalStages={totalStages}
        />
        <CreateRequestModal
          open={isCreateOpen}
          onClose={() => {
            setIsCreateOpen(false)
            if (user?.counterpartyId) fetchRequests(user.counterpartyId)
          }}
        />
        <ViewRequestModal open={!!viewRecord} request={viewRecord} onClose={() => setViewRecord(null)} />
        <ViewRequestModal
          open={!!resubmitRecord}
          request={resubmitRecord}
          onClose={() => setResubmitRecord(null)}
          resubmitMode
          onResubmit={handleResubmit}
        />
      </div>
    )
  }

  // Формируем вкладки для admin/user
  const tabItems = [
    {
      key: 'all',
      label: 'Все',
      children: (
        <RequestsTable
          requests={requests}
          isLoading={isLoading}
          onView={setViewRecord}
          isAdmin={isAdmin}
          onDelete={handleDelete}
          uploadTasks={uploadTasks}
          onRetryUpload={retryTask}
        />
      ),
    },
  ]

  // Вкладка "На согласование" — только если подразделение в цепочке
  if (userDeptInChain) {
    tabItems.push({
      key: 'pending',
      label: 'На согласование',
      children: (
        <RequestsTable
          requests={pendingRequests}
          isLoading={approvalLoading}
          onView={setViewRecord}
          showApprovalActions
          onApprove={handleApprove}
          onReject={handleReject}
        />
      ),
    })
  }

  tabItems.push(
    {
      key: 'approved',
      label: 'Согласовано',
      children: (
        <RequestsTable
          requests={approvedRequests}
          isLoading={approvalLoading}
          onView={setViewRecord}
          showApprovedDate
        />
      ),
    },
    {
      key: 'rejected',
      label: 'Отклонено',
      children: (
        <RequestsTable
          requests={rejectedRequests}
          isLoading={approvalLoading}
          onView={setViewRecord}
          showRejectedDate
        />
      ),
    },
  )

  return (
    <div>
      <Title level={2} style={{ marginBottom: 16 }}>Заявки на оплату</Title>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      <ViewRequestModal
        open={!!viewRecord}
        request={viewRecord}
        onClose={() => setViewRecord(null)}
        canEdit={canEditRequest(viewRecord)}
        onEdit={handleEdit}
      />
    </div>
  )
}

export default PaymentRequestsPage
