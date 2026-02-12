import { useEffect, useState } from 'react'
import {
  Typography,
  Table,
  Button,
  Tag,
  Space,
  Popconfirm,
  Select,
  Tooltip,
  message,
} from 'antd'
import {
  PlusOutlined,
  EyeOutlined,
  DeleteOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  RollbackOutlined,
} from '@ant-design/icons'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { useStatusStore } from '@/store/statusStore'
import { useAuthStore } from '@/store/authStore'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import CreateRequestModal from '@/components/paymentRequests/CreateRequestModal'
import ViewRequestModal from '@/components/paymentRequests/ViewRequestModal'
import type { PaymentRequest } from '@/types'

const { Title } = Typography

/** Форматирование даты */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const PaymentRequestsPage = () => {
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [viewRecord, setViewRecord] = useState<PaymentRequest | null>(null)
  const [statusChanging, setStatusChanging] = useState<string | null>(null)

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

  useEffect(() => {
    fetchStatuses('payment_request')
    if (isCounterpartyUser && user?.counterpartyId) {
      fetchRequests(user.counterpartyId)
    } else {
      fetchRequests()
    }
  }, [fetchStatuses, fetchRequests, isCounterpartyUser, user?.counterpartyId])

  const handleWithdraw = async (id: string) => {
    await withdrawRequest(id)
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

  const statusOptions = statuses
    .filter((s) => {
      if (!s.isActive) return false
      // Фильтрация по видимости ролей
      if (s.visibleRoles && s.visibleRoles.length > 0 && user?.role) {
        return s.visibleRoles.includes(user.role)
      }
      return true
    })
    .map((s) => ({ label: s.name, value: s.id }))

  const columns = [
    {
      title: 'Номер',
      dataIndex: 'requestNumber',
      key: 'requestNumber',
      width: 170,
    },
    {
      title: 'Контрагент',
      dataIndex: 'counterpartyName',
      key: 'counterpartyName',
    },
    {
      title: 'Статус',
      key: 'status',
      width: 150,
      render: (_: unknown, record: PaymentRequest) => (
        <Tag color={record.statusColor ?? 'default'}>
          {record.statusName}
        </Tag>
      ),
    },
    {
      title: 'Срочность',
      dataIndex: 'urgencyValue',
      key: 'urgencyValue',
      width: 120,
    },
    {
      title: 'Срок поставки',
      dataIndex: 'deliveryDays',
      key: 'deliveryDays',
      width: 130,
      render: (days: number) => `${days} дн.`,
    },
    {
      title: 'Дата',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (date: string) => formatDate(date),
    },
    {
      title: 'Загрузка',
      key: 'upload',
      width: 110,
      render: (_: unknown, record: PaymentRequest) => {
        if (record.totalFiles === 0) return null

        // Проверяем in-memory очередь для ошибок текущей сессии
        const inMemoryTask = uploadTasks[record.id]
        if (inMemoryTask?.status === 'error') {
          return (
            <Space size={4}>
              <CloseCircleOutlined style={{ color: '#f5222d' }} />
              <Button
                type="link"
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => retryTask(record.id)}
                style={{ padding: 0 }}
              />
            </Space>
          )
        }

        // Все загружены
        if (record.uploadedFiles >= record.totalFiles) {
          return (
            <Tooltip title={`${record.uploadedFiles}/${record.totalFiles}`}>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
            </Tooltip>
          )
        }

        // Ещё загружаются
        return (
          <Space size={4}>
            <SyncOutlined spin style={{ color: '#fa8c16' }} />
            <span style={{ color: '#fa8c16', fontSize: 12 }}>
              {record.uploadedFiles}/{record.totalFiles}
            </span>
          </Space>
        )
      },
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 180,
      render: (_: unknown, record: PaymentRequest) => (
        <Space>
          <Tooltip title="Просмотр">
            <Button
              icon={<EyeOutlined />}
              size="small"
              onClick={() => setViewRecord(record)}
            />
          </Tooltip>

          {/* counterparty_user: отзыв заявки */}
          {isCounterpartyUser && (
            <Popconfirm
              title="Отозвать заявку?"
              onConfirm={() => handleWithdraw(record.id)}
            >
              <Tooltip title="Отозвать">
                <Button icon={<RollbackOutlined />} danger size="small" />
              </Tooltip>
            </Popconfirm>
          )}

          {/* admin/user: изменение статуса */}
          {!isCounterpartyUser && (
            <Select
              size="small"
              style={{ width: 150 }}
              value={record.statusId}
              options={statusOptions}
              loading={statusChanging === record.id}
              onChange={(val) => handleStatusChange(record.id, val)}
            />
          )}

          {/* admin: удаление заявки */}
          {isAdmin && (
            <Popconfirm
              title="Удалить заявку?"
              description="Заявка и все файлы будут удалены безвозвратно"
              onConfirm={() => handleDelete(record.id)}
            >
              <Tooltip title="Удалить">
                <Button icon={<DeleteOutlined />} danger size="small" />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Title level={2} style={{ margin: 0 }}>
          Заявки на оплату
        </Title>
        {isCounterpartyUser && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsCreateOpen(true)}
          >
            Добавить
          </Button>
        )}
      </div>

      <Table
        columns={columns}
        dataSource={requests}
        rowKey="id"
        loading={isLoading}
        scroll={{ x: 1000 }}
      />

      {/* Модал создания */}
      <CreateRequestModal
        open={isCreateOpen}
        onClose={() => {
          setIsCreateOpen(false)
          if (isCounterpartyUser && user?.counterpartyId) {
            fetchRequests(user.counterpartyId)
          }
        }}
      />

      {/* Модал просмотра */}
      <ViewRequestModal
        open={!!viewRecord}
        request={viewRecord}
        onClose={() => setViewRecord(null)}
      />
    </div>
  )
}

export default PaymentRequestsPage
