import { useMemo } from 'react'
import {
  Table,
  Tag,
  Space,
  Button,
  Tooltip,
  Popconfirm,
  Select,
  Input,
  Modal,
} from 'antd'
import {
  EyeOutlined,
  DeleteOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  RollbackOutlined,
  CheckOutlined,
  StopOutlined,
  RedoOutlined,
} from '@ant-design/icons'
import { useState } from 'react'
import type { PaymentRequest } from '@/types'

const { TextArea } = Input

/** Форматирование даты */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Уникальные значения для фильтра */
function uniqueFilters(items: (string | undefined)[]): { text: string; value: string }[] {
  const unique = [...new Set(items.filter(Boolean) as string[])]
  return unique.sort().map((v) => ({ text: v, value: v }))
}

export interface RequestsTableProps {
  requests: PaymentRequest[]
  isLoading: boolean
  onView: (record: PaymentRequest) => void
  // Для counterparty_user
  isCounterpartyUser?: boolean
  onWithdraw?: (id: string, comment: string) => void
  // Для admin/user — смена статуса
  statusOptions?: { label: string; value: string }[]
  onStatusChange?: (id: string, statusId: string) => void
  statusChangingId?: string | null
  // Только admin — удаление
  isAdmin?: boolean
  onDelete?: (id: string) => void
  // Загрузка файлов
  uploadTasks?: Record<string, { status: string }>
  onRetryUpload?: (id: string) => void
  // Согласование
  showApprovalActions?: boolean
  onApprove?: (id: string, comment: string) => void
  onReject?: (id: string, comment: string) => void
  // Повторная отправка
  onResubmit?: (record: PaymentRequest) => void
  // Дополнительные столбцы для вкладок
  showApprovedDate?: boolean
  showRejectedDate?: boolean
  // Доп. фильтры
  showDepartmentFilter?: boolean
  rejectionDepartments?: { text: string; value: string }[]
}

const RequestsTable = (props: RequestsTableProps) => {
  const {
    requests,
    isLoading,
    onView,
    isCounterpartyUser,
    onWithdraw,
    statusOptions,
    onStatusChange,
    statusChangingId,
    isAdmin,
    onDelete,
    uploadTasks,
    onRetryUpload,
    showApprovalActions,
    onApprove,
    onReject,
    showApprovedDate,
    showRejectedDate,
    showDepartmentFilter,
    rejectionDepartments,
    onResubmit,
  } = props

  const [approvalModal, setApprovalModal] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null)
  const [approvalComment, setApprovalComment] = useState('')
  const [withdrawModal, setWithdrawModal] = useState<string | null>(null)
  const [withdrawComment, setWithdrawComment] = useState('')

  const counterpartyFilters = useMemo(
    () => uniqueFilters(requests.map((r) => r.counterpartyName)),
    [requests],
  )
  const statusFilters = useMemo(
    () => uniqueFilters(requests.map((r) => r.statusName)),
    [requests],
  )
  const siteFilters = useMemo(
    () => uniqueFilters(requests.map((r) => r.siteName)),
    [requests],
  )

  const handleApprovalConfirm = () => {
    if (!approvalModal) return
    if (approvalModal.action === 'approve') {
      onApprove?.(approvalModal.id, approvalComment)
    } else {
      onReject?.(approvalModal.id, approvalComment)
    }
    setApprovalModal(null)
    setApprovalComment('')
  }

  const columns: Record<string, unknown>[] = [
    {
      title: 'Номер',
      dataIndex: 'requestNumber',
      key: 'requestNumber',
      width: 170,
      sorter: (a: PaymentRequest, b: PaymentRequest) =>
        a.requestNumber.localeCompare(b.requestNumber),
    },
    {
      title: 'Подрядчик',
      dataIndex: 'counterpartyName',
      key: 'counterpartyName',
      filters: counterpartyFilters,
      onFilter: (value: unknown, record: PaymentRequest) =>
        record.counterpartyName === value,
    },
    {
      title: 'Объект',
      dataIndex: 'siteName',
      key: 'siteName',
      filters: siteFilters,
      onFilter: (value: unknown, record: PaymentRequest) =>
        record.siteName === value,
      render: (name: string | undefined) => name ?? '—',
    },
    {
      title: 'Статус',
      key: 'status',
      width: 150,
      filters: statusFilters,
      onFilter: (value: unknown, record: PaymentRequest) =>
        record.statusName === value,
      render: (_: unknown, record: PaymentRequest) => (
        <Tag color={record.statusColor ?? 'default'}>
          {record.statusName}
        </Tag>
      ),
    },
    {
      title: 'Дата создания',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      sorter: (a: PaymentRequest, b: PaymentRequest) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend' as const,
      render: (date: string) => formatDate(date),
    },
  ]

  // Дата согласования
  if (showApprovedDate) {
    columns.push({
      title: 'Дата согласования',
      dataIndex: 'approvedAt',
      key: 'approvedAt',
      width: 150,
      sorter: (a: PaymentRequest, b: PaymentRequest) =>
        new Date(a.approvedAt ?? '').getTime() - new Date(b.approvedAt ?? '').getTime(),
      render: (date: string | null) => formatDate(date),
    })
  }

  // Дата отклонения
  if (showRejectedDate) {
    columns.push({
      title: 'Дата отклонения',
      dataIndex: 'rejectedAt',
      key: 'rejectedAt',
      width: 150,
      sorter: (a: PaymentRequest, b: PaymentRequest) =>
        new Date(a.rejectedAt ?? '').getTime() - new Date(b.rejectedAt ?? '').getTime(),
      render: (date: string | null) => formatDate(date),
    })
  }

  // Фильтр по подразделению (на вкладке Отклонено)
  if (showDepartmentFilter && rejectionDepartments) {
    columns.push({
      title: 'Кто отклонил',
      key: 'rejectedBy',
      width: 180,
      filters: rejectionDepartments,
      onFilter: () => true, // Фильтрация происходит на уровне данных
    })
  }

  // Загрузка файлов (для вкладки Все и counterparty)
  if (uploadTasks) {
    columns.push({
      title: 'Загрузка',
      key: 'upload',
      width: 110,
      render: (_: unknown, record: PaymentRequest) => {
        if (record.totalFiles === 0) return null
        const task = uploadTasks[record.id]
        if (task?.status === 'error') {
          return (
            <Space size={4}>
              <CloseCircleOutlined style={{ color: '#f5222d' }} />
              <Button
                type="link"
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => onRetryUpload?.(record.id)}
                style={{ padding: 0 }}
              />
            </Space>
          )
        }
        if (record.uploadedFiles >= record.totalFiles) {
          return (
            <Tooltip title={`${record.uploadedFiles}/${record.totalFiles}`}>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
            </Tooltip>
          )
        }
        return (
          <Space size={4}>
            <SyncOutlined spin style={{ color: '#fa8c16' }} />
            <span style={{ color: '#fa8c16', fontSize: 12 }}>
              {record.uploadedFiles}/{record.totalFiles}
            </span>
          </Space>
        )
      },
    })
  }

  // Действия
  const actionsColumn: Record<string, unknown> = {
    title: 'Действия',
    key: 'actions',
    width: showApprovalActions ? 200 : 180,
    render: (_: unknown, record: PaymentRequest) => (
      <Space>
        <Tooltip title="Просмотр">
          <Button icon={<EyeOutlined />} size="small" onClick={() => onView(record)} />
        </Tooltip>

        {/* Кнопки согласования */}
        {showApprovalActions && (
          <>
            <Tooltip title="Согласовать">
              <Button
                type="primary"
                icon={<CheckOutlined />}
                size="small"
                onClick={() => setApprovalModal({ id: record.id, action: 'approve' })}
              />
            </Tooltip>
            <Tooltip title="Отклонить">
              <Button
                danger
                icon={<StopOutlined />}
                size="small"
                onClick={() => setApprovalModal({ id: record.id, action: 'reject' })}
              />
            </Tooltip>
          </>
        )}

        {/* counterparty_user: отзыв */}
        {isCounterpartyUser && onWithdraw && !record.withdrawnAt && (
          <Tooltip title="Отозвать">
            <Button
              icon={<RollbackOutlined />}
              danger
              size="small"
              onClick={() => setWithdrawModal(record.id)}
            />
          </Tooltip>
        )}

        {/* counterparty_user: повторная отправка отклоненной заявки */}
        {isCounterpartyUser && onResubmit && record.rejectedAt && (
          <Tooltip title="Отправить повторно">
            <Button
              icon={<RedoOutlined />}
              type="primary"
              size="small"
              onClick={() => onResubmit(record)}
            />
          </Tooltip>
        )}

        {/* admin/user: смена статуса */}
        {!isCounterpartyUser && statusOptions && onStatusChange && !showApprovalActions && (
          <Select
            size="small"
            style={{ width: 150 }}
            value={record.statusId}
            options={statusOptions}
            loading={statusChangingId === record.id}
            onChange={(val) => onStatusChange(record.id, val)}
          />
        )}

        {/* admin: удаление */}
        {isAdmin && onDelete && (
          <Popconfirm
            title="Удалить заявку?"
            description="Заявка и все файлы будут удалены безвозвратно"
            onConfirm={() => onDelete(record.id)}
          >
            <Tooltip title="Удалить">
              <Button icon={<DeleteOutlined />} danger size="small" />
            </Tooltip>
          </Popconfirm>
        )}
      </Space>
    ),
  }

  columns.push(actionsColumn)

  return (
    <>
      <Table
        columns={columns as any}
        dataSource={requests}
        rowKey="id"
        loading={isLoading}
        scroll={{ x: 1200 }}
      />

      {/* Модал подтверждения согласования/отклонения */}
      <Modal
        title={approvalModal?.action === 'approve' ? 'Согласование заявки' : 'Отклонение заявки'}
        open={!!approvalModal}
        onOk={handleApprovalConfirm}
        onCancel={() => { setApprovalModal(null); setApprovalComment('') }}
        okText={approvalModal?.action === 'approve' ? 'Согласовать' : 'Отклонить'}
        okButtonProps={{ danger: approvalModal?.action === 'reject' }}
      >
        <TextArea
          rows={3}
          placeholder="Комментарий (необязательно)"
          value={approvalComment}
          onChange={(e) => setApprovalComment(e.target.value)}
        />
      </Modal>

      {/* Модал отзыва заявки */}
      <Modal
        title="Отзыв заявки"
        open={!!withdrawModal}
        onOk={() => {
          if (withdrawModal) onWithdraw?.(withdrawModal, withdrawComment)
          setWithdrawModal(null)
          setWithdrawComment('')
        }}
        onCancel={() => { setWithdrawModal(null); setWithdrawComment('') }}
        okText="Отозвать"
        okButtonProps={{ danger: true }}
      >
        <TextArea
          rows={3}
          placeholder="Комментарий (необязательно)"
          value={withdrawComment}
          onChange={(e) => setWithdrawComment(e.target.value)}
        />
      </Modal>
    </>
  )
}

export default RequestsTable
