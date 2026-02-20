import { useMemo, useState } from 'react'
import {
  Table,
  Tag,
  Space,
  Button,
  Tooltip,
  Popconfirm,
  Select,
  Progress,
  App,
} from 'antd'
import {
  EyeOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  RollbackOutlined,
  CheckOutlined,
  StopOutlined,
  RedoOutlined,
} from '@ant-design/icons'
import RejectModal from './RejectModal'
import WithdrawModal from './WithdrawModal'
import { formatDateShort, extractRequestNumber, calculateDays } from '@/utils/requestFormatters'
import type { PaymentRequest } from '@/types'

export interface RequestsTableProps {
  requests: PaymentRequest[]
  isLoading: boolean
  onView: (record: PaymentRequest) => void
  isCounterpartyUser?: boolean
  onWithdraw?: (id: string, comment: string) => void
  hideCounterpartyColumn?: boolean
  statusOptions?: { label: string; value: string }[]
  onStatusChange?: (id: string, statusId: string) => void
  statusChangingId?: string | null
  isAdmin?: boolean
  onDelete?: (id: string) => void
  uploadTasks?: Record<string, { status: string }>
  totalStages?: number
  showApprovalActions?: boolean
  onApprove?: (id: string, comment: string) => void
  onReject?: (id: string, comment: string, files?: { id: string; file: File }[]) => void
  onResubmit?: (record: PaymentRequest) => void
  showApprovedDate?: boolean
  showRejectedDate?: boolean
  showDepartmentFilter?: boolean
  rejectionDepartments?: { text: string; value: string }[]
  showResponsibleColumn?: boolean
  canAssignResponsible?: boolean
  omtsUsers?: { id: string; fullName: string }[]
  onAssignResponsible?: (requestId: string, userId: string) => void
  responsibleFilter?: 'assigned' | 'unassigned' | null
}

const RequestsTable = (props: RequestsTableProps) => {
  const { message: _message } = App.useApp()
  const {
    requests, isLoading, onView, isCounterpartyUser, onWithdraw, hideCounterpartyColumn,
    statusOptions, onStatusChange, statusChangingId, isAdmin, onDelete, uploadTasks,
    showApprovalActions, onApprove, onReject, showApprovedDate, showRejectedDate,
    totalStages, showDepartmentFilter, rejectionDepartments, onResubmit,
    showResponsibleColumn, canAssignResponsible, omtsUsers, onAssignResponsible, responsibleFilter,
  } = props

  const [rejectModalId, setRejectModalId] = useState<string | null>(null)
  const [withdrawModalId, setWithdrawModalId] = useState<string | null>(null)

  const filteredRequests = useMemo(() => {
    if (responsibleFilter === 'assigned') return requests.filter(r => r.assignedUserId !== null)
    if (responsibleFilter === 'unassigned') return requests.filter(r => r.assignedUserId === null)
    return requests
  }, [requests, responsibleFilter])

  const columns: Record<string, unknown>[] = [
    {
      title: 'Номер', dataIndex: 'requestNumber', key: 'requestNumber', width: 100,
      sorter: (a: PaymentRequest, b: PaymentRequest) => parseInt(extractRequestNumber(a.requestNumber), 10) - parseInt(extractRequestNumber(b.requestNumber), 10),
      render: (requestNumber: string) => extractRequestNumber(requestNumber),
    },
  ]

  if (!hideCounterpartyColumn) {
    columns.push({
      title: 'Подрядчик', dataIndex: 'counterpartyName', key: 'counterpartyName',
      sorter: (a: PaymentRequest, b: PaymentRequest) => (a.counterpartyName || '').localeCompare(b.counterpartyName || '', 'ru'),
    })
  }

  columns.push(
    {
      title: 'Объект', dataIndex: 'siteName', key: 'siteName',
      sorter: (a: PaymentRequest, b: PaymentRequest) => (a.siteName || '').localeCompare(b.siteName || '', 'ru'),
      render: (name: string | undefined) => name ?? '—',
    },
    {
      title: 'Статус', key: 'status', width: 150,
      sorter: (a: PaymentRequest, b: PaymentRequest) => (a.statusName || '').localeCompare(b.statusName || '', 'ru'),
      render: (_: unknown, record: PaymentRequest) => <Tag color={record.statusColor ?? 'default'}>{record.statusName}</Tag>,
    },
    {
      title: 'Сумма счета', dataIndex: 'invoiceAmount', key: 'invoiceAmount', width: 156, align: 'right' as const,
      sorter: (a: PaymentRequest, b: PaymentRequest) => (a.invoiceAmount ?? 0) - (b.invoiceAmount ?? 0),
      render: (amount: number | null) => {
        if (amount == null) return <span style={{ color: '#bfbfbf' }}>—</span>
        return amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'
      },
    },
  )

  if (showResponsibleColumn) {
    columns.push({
      title: 'Ответственный', key: 'responsible', width: 200,
      sorter: (a: PaymentRequest, b: PaymentRequest) => {
        const aVal = a.assignedUserFullName || ''
        const bVal = b.assignedUserFullName || ''
        if (!aVal && !bVal) return 0
        if (!aVal) return 1
        if (!bVal) return -1
        return aVal.localeCompare(bVal, 'ru')
      },
      render: (_: unknown, record: PaymentRequest) => {
        if (canAssignResponsible && omtsUsers && onAssignResponsible) {
          return (
            <Select
              value={record.assignedUserId ?? undefined}
              placeholder="Не назначен"
              style={{ width: '100%' }}
              allowClear
              onChange={(value) => onAssignResponsible(record.id, value)}
              options={omtsUsers.map((u) => ({ label: u.fullName, value: u.id }))}
            />
          )
        }
        return <span>{record.assignedUserFullName || record.assignedUserEmail || '—'}</span>
      },
    })
  }

  columns.push(
    {
      title: 'Дата создания', dataIndex: 'createdAt', key: 'createdAt', width: 100,
      sorter: (a: PaymentRequest, b: PaymentRequest) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend' as const,
      render: (date: string) => formatDateShort(date),
    },
    {
      title: 'Срок', key: 'days', width: 80,
      sorter: (a: PaymentRequest, b: PaymentRequest) => calculateDays(a.createdAt, a.approvedAt) - calculateDays(b.createdAt, b.approvedAt),
      render: (_: unknown, record: PaymentRequest) => <span>{calculateDays(record.createdAt, record.approvedAt)}</span>,
    },
  )

  if (showApprovedDate) {
    columns.push({
      title: 'Дата согласования', dataIndex: 'approvedAt', key: 'approvedAt', width: 100,
      sorter: (a: PaymentRequest, b: PaymentRequest) => new Date(a.approvedAt ?? '').getTime() - new Date(b.approvedAt ?? '').getTime(),
      render: (date: string | null) => formatDateShort(date),
    })
  }

  if (showRejectedDate) {
    columns.push({
      title: 'Дата отклонения', dataIndex: 'rejectedAt', key: 'rejectedAt', width: 100,
      sorter: (a: PaymentRequest, b: PaymentRequest) => new Date(a.rejectedAt ?? '').getTime() - new Date(b.rejectedAt ?? '').getTime(),
      render: (date: string | null) => formatDateShort(date),
    })
  }

  if (showDepartmentFilter && rejectionDepartments) {
    columns.push({ title: 'Кто отклонил', key: 'rejectedBy', width: 180, filters: rejectionDepartments, onFilter: () => true })
  }

  columns.push({
    title: 'Файлы', key: 'files', width: 100,
    render: (_: unknown, record: PaymentRequest) => {
      if (record.totalFiles === 0) return <span style={{ color: '#bfbfbf' }}>—</span>
      if (record.uploadedFiles >= record.totalFiles) {
        return (
          <Tooltip title={`${record.totalFiles} файл(ов)`}>
            <Space size={4}><CheckCircleOutlined style={{ color: '#52c41a' }} /><span>{record.totalFiles}</span></Space>
          </Tooltip>
        )
      }
      return <span style={{ color: '#fa8c16' }}>{record.uploadedFiles}/{record.totalFiles}</span>
    },
  })

  if (isCounterpartyUser && totalStages && totalStages > 0) {
    columns.push({
      title: 'Согласование', key: 'approval', width: 160,
      sorter: (a: PaymentRequest, b: PaymentRequest) => {
        const getWeight = (r: PaymentRequest) => {
          if (r.approvedAt) return 3000
          if (r.currentStage && !r.withdrawnAt && !r.rejectedAt) return 2000 + (r.currentStage || 0)
          if (r.rejectedAt) return 1000
          return 0
        }
        return getWeight(a) - getWeight(b)
      },
      render: (_: unknown, record: PaymentRequest) => {
        if (uploadTasks?.[record.id]?.status === 'error') {
          return <Tooltip title="Ошибка загрузки файлов"><Space size={4}><CloseCircleOutlined style={{ color: '#f5222d' }} /><span style={{ color: '#f5222d', fontSize: 12 }}>Ошибка загрузки</span></Space></Tooltip>
        }
        if (record.approvedAt) return <Tooltip title="Согласовано"><div style={{ width: '80%' }}><Progress percent={100} size={{ height: 5 }} status="success" showInfo={false} /></div></Tooltip>
        if (record.rejectedAt) {
          const rejectedPercent = record.rejectedStage === 1 ? 50 : 100
          return <Tooltip title={`Отклонено на ${record.rejectedStage === 1 ? 'Штабе' : 'ОМТС'}`}><div style={{ width: '80%' }}><Progress percent={rejectedPercent} size={{ height: 5 }} status="exception" showInfo={false} /></div></Tooltip>
        }
        if (record.withdrawnAt || !record.currentStage) return <span style={{ color: '#bfbfbf' }}>—</span>
        const completedStages = record.currentStage - 1
        const percent = Math.round((completedStages / totalStages) * 100)
        const stageLabel = record.currentStage === 1 ? 'Штаб' : 'ОМТС'
        return <Tooltip title={`На стадии ${stageLabel}`}><div style={{ width: '80%' }}><Progress percent={percent} size={{ height: 5 }} strokeColor="#fa8c16" showInfo={false} /></div></Tooltip>
      },
    })
  }

  columns.push({
    title: 'Действия', key: 'actions', width: showApprovalActions ? 200 : 180,
    render: (_: unknown, record: PaymentRequest) => (
      <Space>
        <Tooltip title="Просмотр"><Button icon={<EyeOutlined />} size="small" onClick={() => onView(record)} /></Tooltip>
        {showApprovalActions && (
          <>
            <Tooltip title="Согласовать">
              <Popconfirm title="Согласование заявки" description="Подтвердите согласование заявки" onConfirm={() => onApprove?.(record.id, '')} okText="Согласовать" cancelText="Отмена">
                <Button type="primary" icon={<CheckOutlined />} size="small" />
              </Popconfirm>
            </Tooltip>
            <Tooltip title="Отклонить"><Button danger icon={<StopOutlined />} size="small" onClick={() => setRejectModalId(record.id)} /></Tooltip>
          </>
        )}
        {isCounterpartyUser && onWithdraw && !record.withdrawnAt && (
          <Tooltip title="Отозвать"><Button icon={<RollbackOutlined />} danger size="small" onClick={() => setWithdrawModalId(record.id)} /></Tooltip>
        )}
        {isCounterpartyUser && onResubmit && record.rejectedAt && (
          <Tooltip title="Отправить повторно"><Button icon={<RedoOutlined />} type="primary" size="small" onClick={() => onResubmit(record)} /></Tooltip>
        )}
        {!isCounterpartyUser && statusOptions && onStatusChange && !showApprovalActions && (
          <Select size="small" style={{ width: 150 }} value={record.statusId} options={statusOptions} loading={statusChangingId === record.id} onChange={(val) => onStatusChange(record.id, val)} />
        )}
        {isAdmin && onDelete && !record.isDeleted && (
          <Popconfirm title="Удалить заявку?" description="Заявка станет неактивной, но данные и файлы сохранятся" onConfirm={() => onDelete(record.id)}>
            <Tooltip title="Удалить"><Button icon={<DeleteOutlined />} danger size="small" /></Tooltip>
          </Popconfirm>
        )}
      </Space>
    ),
  })

  return (
    <>
      <Table
        columns={columns as any}
        dataSource={filteredRequests}
        rowKey="id"
        loading={isLoading}
        scroll={{ x: 1200 }}
        pagination={{ showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], defaultPageSize: 20 }}
        rowClassName={(record: PaymentRequest) => {
          const classes: string[] = []
          if (uploadTasks?.[record.id]?.status === 'error') classes.push('row-upload-error')
          if (record.isDeleted) classes.push('row-deleted')
          return classes.join(' ')
        }}
      />
      <style>{`.row-upload-error td { background-color: #fff1f0 !important; } .row-deleted td { opacity: 0.45; }`}</style>

      <RejectModal
        open={!!rejectModalId}
        onConfirm={(comment, files) => {
          if (rejectModalId) onReject?.(rejectModalId, comment, files)
          setRejectModalId(null)
        }}
        onCancel={() => setRejectModalId(null)}
      />

      <WithdrawModal
        open={!!withdrawModalId}
        onConfirm={(comment) => {
          if (withdrawModalId) onWithdraw?.(withdrawModalId, comment)
          setWithdrawModalId(null)
        }}
        onCancel={() => setWithdrawModalId(null)}
      />
    </>
  )
}

export default RequestsTable
