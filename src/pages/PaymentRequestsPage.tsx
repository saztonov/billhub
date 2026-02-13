import { useEffect, useMemo, useState } from 'react'
import { Typography, Button, Tabs, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { useStatusStore } from '@/store/statusStore'
import { useAuthStore } from '@/store/authStore'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import { useApprovalStore } from '@/store/approvalStore'
import CreateRequestModal from '@/components/paymentRequests/CreateRequestModal'
import ViewRequestModal from '@/components/paymentRequests/ViewRequestModal'
import RequestsTable from '@/components/paymentRequests/RequestsTable'
import type { PaymentRequest } from '@/types'

const { Title } = Typography

const PaymentRequestsPage = () => {
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [viewRecord, setViewRecord] = useState<PaymentRequest | null>(null)
  const [statusChanging, setStatusChanging] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('all')

  const user = useAuthStore((s) => s.user)
  const isCounterpartyUser = user?.role === 'counterparty_user'
  const isAdmin = user?.role === 'admin'

  const {
    requests,
    isLoading,
    fetchRequests,
    deleteRequest,
    withdrawRequest,
    updateRequestStatus,
  } = usePaymentRequestStore()

  const { statuses, fetchStatuses } = useStatusStore()
  const retryTask = useUploadQueueStore((s) => s.retryTask)
  const uploadTasks = useUploadQueueStore((s) => s.tasks)

  const {
    stages,
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    isLoading: approvalLoading,
    fetchStages,
    fetchPendingRequests,
    fetchApprovedRequests,
    fetchRejectedRequests,
    approveRequest,
    rejectRequest,
  } = useApprovalStore()

  // Проверяем, участвует ли подразделение пользователя в цепочке
  const userDeptInChain = useMemo(() => {
    if (!user?.departmentId || stages.length === 0) return false
    return stages.some((s) => s.departmentId === user.departmentId)
  }, [user?.departmentId, stages])

  useEffect(() => {
    fetchStatuses('payment_request')
    if (isCounterpartyUser && user?.counterpartyId) {
      fetchRequests(user.counterpartyId)
    } else {
      fetchRequests()
      fetchStages()
    }
  }, [fetchStatuses, fetchRequests, fetchStages, isCounterpartyUser, user?.counterpartyId])

  // Загружаем данные при переключении вкладок
  useEffect(() => {
    if (isCounterpartyUser) return
    if (activeTab === 'pending' && user?.departmentId) {
      fetchPendingRequests(user.departmentId)
    } else if (activeTab === 'approved') {
      fetchApprovedRequests()
    } else if (activeTab === 'rejected') {
      fetchRejectedRequests()
    }
  }, [activeTab, isCounterpartyUser, user?.departmentId, fetchPendingRequests, fetchApprovedRequests, fetchRejectedRequests])

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

  const handleStatusChange = async (requestId: string, statusId: string) => {
    setStatusChanging(requestId)
    await updateRequestStatus(requestId, statusId)
    message.success('Статус изменён')
    setStatusChanging(null)
  }

  const handleApprove = async (requestId: string, comment: string) => {
    if (!user?.departmentId || !user?.id) return
    await approveRequest(requestId, user.departmentId, user.id, comment)
    message.success('Заявка согласована')
    fetchPendingRequests(user.departmentId)
    fetchRequests()
  }

  const handleReject = async (requestId: string, comment: string) => {
    if (!user?.departmentId || !user?.id) return
    await rejectRequest(requestId, user.departmentId, user.id, comment)
    message.success('Заявка отклонена')
    fetchPendingRequests(user.departmentId)
    fetchRequests()
  }

  const statusOptions = statuses
    .filter((s) => {
      if (!s.isActive) return false
      if (s.visibleRoles && s.visibleRoles.length > 0 && user?.role) {
        return s.visibleRoles.includes(user.role)
      }
      return true
    })
    .map((s) => ({ label: s.name, value: s.id }))

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
          uploadTasks={uploadTasks}
          onRetryUpload={retryTask}
        />
        <CreateRequestModal
          open={isCreateOpen}
          onClose={() => {
            setIsCreateOpen(false)
            if (user?.counterpartyId) fetchRequests(user.counterpartyId)
          }}
        />
        <ViewRequestModal open={!!viewRecord} request={viewRecord} onClose={() => setViewRecord(null)} />
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
          statusOptions={statusOptions}
          onStatusChange={handleStatusChange}
          statusChangingId={statusChanging}
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
      <ViewRequestModal open={!!viewRecord} request={viewRecord} onClose={() => setViewRecord(null)} />
    </div>
  )
}

export default PaymentRequestsPage
