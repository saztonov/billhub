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
  Progress,
  Upload,
  List,
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
  InboxOutlined,
  CloseOutlined,
} from '@ant-design/icons'
import { useState } from 'react'
import type { PaymentRequest } from '@/types'

const { TextArea } = Input
const { Dragger } = Upload

// Поддерживаемые расширения файлов для отклонения
const ACCEPT_EXTENSIONS = '.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.pdf'

/** Форматирование даты (только день и месяц) */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
  })
}

/** Извлечение порядкового номера из request_number (для обратной совместимости со старым форматом) */
function extractRequestNumber(requestNumber: string): string {
  // Если есть старый формат "000018_140226", извлекаем порядковый номер
  const parts = requestNumber.split('_')
  if (parts.length > 1) {
    // Старый формат - убираем нули впереди
    return parseInt(parts[0], 10).toString()
  }
  // Новый формат - возвращаем как есть
  return requestNumber
}

/** Расчет количества дней между двумя датами */
function calculateDays(fromDate: string, toDate: string | null): number {
  const from = new Date(fromDate)
  const to = toDate ? new Date(toDate) : new Date()
  const diffMs = to.getTime() - from.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

export interface RequestsTableProps {
  requests: PaymentRequest[]
  isLoading: boolean
  onView: (record: PaymentRequest) => void
  // Для counterparty_user
  isCounterpartyUser?: boolean
  onWithdraw?: (id: string, comment: string) => void
  hideCounterpartyColumn?: boolean
  // Для admin/user — смена статуса
  statusOptions?: { label: string; value: string }[]
  onStatusChange?: (id: string, statusId: string) => void
  statusChangingId?: string | null
  // Только admin — удаление
  isAdmin?: boolean
  onDelete?: (id: string) => void
  // Задачи загрузки (для подсветки ошибок)
  uploadTasks?: Record<string, { status: string }>
  // Прогресс согласования (для counterparty_user)
  totalStages?: number
  // Согласование
  showApprovalActions?: boolean
  onApprove?: (id: string, comment: string) => void
  onReject?: (id: string, comment: string, files?: { id: string; file: File }[]) => void
  // Повторная отправка
  onResubmit?: (record: PaymentRequest) => void
  // Дополнительные столбцы для вкладок
  showApprovedDate?: boolean
  showRejectedDate?: boolean
  // Доп. фильтры
  showDepartmentFilter?: boolean
  rejectionDepartments?: { text: string; value: string }[]
  // Назначение ответственного
  showResponsibleColumn?: boolean
  canAssignResponsible?: boolean
  omtsUsers?: { id: string; fullName: string }[]
  onAssignResponsible?: (requestId: string, userId: string) => void
  responsibleFilter?: 'assigned' | 'unassigned' | null
}

const RequestsTable = (props: RequestsTableProps) => {
  const { message } = App.useApp()
  const {
    requests,
    isLoading,
    onView,
    isCounterpartyUser,
    onWithdraw,
    hideCounterpartyColumn,
    statusOptions,
    onStatusChange,
    statusChangingId,
    isAdmin,
    onDelete,
    uploadTasks,
    showApprovalActions,
    onApprove,
    onReject,
    showApprovedDate,
    showRejectedDate,
    totalStages,
    showDepartmentFilter,
    rejectionDepartments,
    onResubmit,
    showResponsibleColumn,
    canAssignResponsible,
    omtsUsers,
    onAssignResponsible,
    responsibleFilter,
  } = props

  const [rejectModal, setRejectModal] = useState<string | null>(null)
  const [rejectComment, setRejectComment] = useState('')
  const [rejectFiles, setRejectFiles] = useState<File[]>([])
  const [withdrawModal, setWithdrawModal] = useState<string | null>(null)
  const [withdrawComment, setWithdrawComment] = useState('')

  // Фильтрация по наличию ответственного
  const filteredRequests = useMemo(() => {
    let filtered = requests

    if (responsibleFilter === 'assigned') {
      filtered = filtered.filter(r => r.assignedUserId !== null)
    } else if (responsibleFilter === 'unassigned') {
      filtered = filtered.filter(r => r.assignedUserId === null)
    }

    return filtered
  }, [requests, responsibleFilter])

  const handleRejectConfirm = async () => {
    if (!rejectModal) return

    // Валидация комментария
    if (!rejectComment.trim()) {
      message.error('Комментарий обязателен при отклонении заявки')
      return
    }

    // Конвертируем File[] в FileItem[]
    const fileItems = rejectFiles.map((file, index) => ({
      id: `${Date.now()}_${index}`,
      file,
    }))

    await onReject?.(rejectModal, rejectComment, fileItems)
    setRejectModal(null)
    setRejectComment('')
    setRejectFiles([])
  }

  const handleFileBeforeUpload = (file: File): boolean => {
    setRejectFiles(prev => [...prev, file])
    return false // Отмена автоматической загрузки
  }

  const handleFileRemove = (file: File) => {
    setRejectFiles(prev => prev.filter(f => f !== file))
  }

  const columns: Record<string, unknown>[] = [
    {
      title: 'Номер',
      dataIndex: 'requestNumber',
      key: 'requestNumber',
      width: 100,
      sorter: (a: PaymentRequest, b: PaymentRequest) => {
        const numA = parseInt(extractRequestNumber(a.requestNumber), 10)
        const numB = parseInt(extractRequestNumber(b.requestNumber), 10)
        return numA - numB
      },
      render: (requestNumber: string) => extractRequestNumber(requestNumber),
    },
  ]

  // Столбец "Подрядчик" (скрывается для counterparty_user)
  if (!hideCounterpartyColumn) {
    columns.push({
      title: 'Подрядчик',
      dataIndex: 'counterpartyName',
      key: 'counterpartyName',
    })
  }

  columns.push(
    {
      title: 'Объект',
      dataIndex: 'siteName',
      key: 'siteName',
      render: (name: string | undefined) => name ?? '—',
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
      title: 'Сумма счета',
      dataIndex: 'invoiceAmount',
      key: 'invoiceAmount',
      width: 130,
      align: 'right' as const,
      sorter: (a: PaymentRequest, b: PaymentRequest) =>
        (a.invoiceAmount ?? 0) - (b.invoiceAmount ?? 0),
      render: (amount: number | null) => {
        if (amount == null) return <span style={{ color: '#bfbfbf' }}>—</span>
        return amount.toLocaleString('ru-RU', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }) + ' ₽'
      },
    },
  )

  // Столбец "Ответственный" (только для ОМТС)
  if (showResponsibleColumn) {
    columns.push({
      title: 'Ответственный',
      key: 'responsible',
      width: 200,
      render: (_: unknown, record: PaymentRequest) => {
        // Для admin - dropdown
        if (canAssignResponsible && omtsUsers && onAssignResponsible) {
          return (
            <Select
              value={record.assignedUserId ?? undefined}
              placeholder="Не назначен"
              style={{ width: '100%' }}
              allowClear
              onChange={(value) => onAssignResponsible(record.id, value)}
              options={omtsUsers.map((u) => ({
                label: u.fullName,
                value: u.id,
              }))}
            />
          )
        }
        // Для обычных user - только отображение
        return (
          <span>{record.assignedUserFullName || record.assignedUserEmail || '—'}</span>
        )
      },
    })
  }

  columns.push({
    title: 'Дата создания',
    dataIndex: 'createdAt',
    key: 'createdAt',
    width: 100,
    sorter: (a: PaymentRequest, b: PaymentRequest) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    defaultSortOrder: 'descend' as const,
    render: (date: string) => formatDate(date),
  })

  // Столбец "Срок"
  columns.push({
    title: 'Срок',
    key: 'days',
    width: 80,
    sorter: (a: PaymentRequest, b: PaymentRequest) => {
      const daysA = calculateDays(a.createdAt, a.approvedAt)
      const daysB = calculateDays(b.createdAt, b.approvedAt)
      return daysA - daysB
    },
    render: (_: unknown, record: PaymentRequest) => {
      const days = calculateDays(record.createdAt, record.approvedAt)
      return <span>{days}</span>
    },
  })

  // Дата согласования
  if (showApprovedDate) {
    columns.push({
      title: 'Дата согласования',
      dataIndex: 'approvedAt',
      key: 'approvedAt',
      width: 100,
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
      width: 100,
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

  // Файлы (количество загруженных / общее)
  columns.push({
    title: 'Файлы',
    key: 'files',
    width: 100,
    render: (_: unknown, record: PaymentRequest) => {
      if (record.totalFiles === 0) return <span style={{ color: '#bfbfbf' }}>—</span>
      if (record.uploadedFiles >= record.totalFiles) {
        return (
          <Tooltip title={`${record.totalFiles} файл(ов)`}>
            <Space size={4}>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
              <span>{record.totalFiles}</span>
            </Space>
          </Tooltip>
        )
      }
      return (
        <span style={{ color: '#fa8c16' }}>
          {record.uploadedFiles}/{record.totalFiles}
        </span>
      )
    },
  })

  // Прогресс согласования (для counterparty_user)
  if (isCounterpartyUser && totalStages && totalStages > 0) {
    columns.push({
      title: 'Согласование',
      key: 'approval',
      width: 160,
      render: (_: unknown, record: PaymentRequest) => {
        // Ошибка загрузки файлов
        if (uploadTasks?.[record.id]?.status === 'error') {
          return (
            <Tooltip title="Ошибка загрузки файлов">
              <Space size={4}>
                <CloseCircleOutlined style={{ color: '#f5222d' }} />
                <span style={{ color: '#f5222d', fontSize: 12 }}>Ошибка загрузки</span>
              </Space>
            </Tooltip>
          )
        }
        // Согласовано
        if (record.approvedAt) {
          return (
            <Tooltip title="Согласовано">
              <div style={{ width: '80%' }}>
                <Progress percent={100} size={{ height: 5 }} status="success" showInfo={false} />
              </div>
            </Tooltip>
          )
        }
        // Отклонено
        if (record.rejectedAt) {
          // Определяем процент по этапу отклонения
          const rejectedPercent = record.rejectedStage === 1 ? 50 : 100
          return (
            <Tooltip title={`Отклонено на ${record.rejectedStage === 1 ? 'Штабе' : 'ОМТС'}`}>
              <div style={{ width: '80%' }}>
                <Progress percent={rejectedPercent} size={{ height: 5 }} status="exception" showInfo={false} />
              </div>
            </Tooltip>
          )
        }
        // Отозвано или не на согласовании
        if (record.withdrawnAt || !record.currentStage) {
          return <span style={{ color: '#bfbfbf' }}>—</span>
        }
        // В процессе согласования
        const completedStages = record.currentStage - 1
        const percent = Math.round((completedStages / totalStages) * 100)
        const stageLabel = record.currentStage === 1 ? 'Штаб' : 'ОМТС'
        return (
          <Tooltip title={`На стадии ${stageLabel}`}>
            <div style={{ width: '80%' }}>
              <Progress
                percent={percent}
                size={{ height: 5 }}
                strokeColor="#fa8c16"
                showInfo={false}
              />
            </div>
          </Tooltip>
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
              <Popconfirm
                title="Согласование заявки"
                description="Подтвердите согласование заявки"
                onConfirm={() => onApprove?.(record.id, '')}
                okText="Согласовать"
                cancelText="Отмена"
              >
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  size="small"
                />
              </Popconfirm>
            </Tooltip>
            <Tooltip title="Отклонить">
              <Button
                danger
                icon={<StopOutlined />}
                size="small"
                onClick={() => setRejectModal(record.id)}
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
        dataSource={filteredRequests}
        rowKey="id"
        loading={isLoading}
        scroll={{ x: 1200 }}
        pagination={{
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          defaultPageSize: 20
        }}
        rowClassName={(record: PaymentRequest) =>
          uploadTasks?.[record.id]?.status === 'error' ? 'row-upload-error' : ''
        }
      />

      {/* Стили подсветки строки с ошибкой загрузки */}
      <style>{`
        .row-upload-error td {
          background-color: #fff1f0 !important;
        }
      `}</style>

      {/* Модал отклонения заявки */}
      <Modal
        title="Отклонение заявки"
        open={!!rejectModal}
        onOk={handleRejectConfirm}
        onCancel={() => {
          setRejectModal(null)
          setRejectComment('')
          setRejectFiles([])
        }}
        okText="Отклонить"
        okButtonProps={{ danger: true }}
        width={600}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>Комментарий *</div>
            <TextArea
              rows={3}
              placeholder="Укажите причину отклонения"
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              status={!rejectComment.trim() ? 'error' : undefined}
            />
          </div>

          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>Прикрепить файлы (необязательно)</div>
            <Dragger
              accept={ACCEPT_EXTENSIONS}
              multiple
              fileList={[]}
              beforeUpload={handleFileBeforeUpload}
              showUploadList={false}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Нажмите или перетащите файлы</p>
              <p className="ant-upload-hint">
                Поддерживаются: PDF, изображения, Word, Excel
              </p>
            </Dragger>

            {rejectFiles.length > 0 && (
              <List
                size="small"
                style={{ marginTop: 16 }}
                bordered
                dataSource={rejectFiles}
                renderItem={(file) => (
                  <List.Item
                    actions={[
                      <Button
                        type="text"
                        icon={<CloseOutlined />}
                        size="small"
                        onClick={() => handleFileRemove(file)}
                      />,
                    ]}
                  >
                    {file.name}
                  </List.Item>
                )}
              />
            )}
          </div>
        </Space>
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
