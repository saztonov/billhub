import { useMemo, useState, useEffect } from 'react'
import {
  Table,
  Tag,
  Space,
  Button,
  Tooltip,
  Popconfirm,
  Select,
  Progress,
  Pagination,
  Badge,
  App,
  Dropdown,
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
  MessageOutlined,
  MoreOutlined,
} from '@ant-design/icons'
import RejectModal from './RejectModal'
import WithdrawModal from './WithdrawModal'
import { formatDateShort, extractRequestNumber, calculateDays } from '@/utils/requestFormatters'
import { useTableScrollY } from '@/hooks/useTableScrollY'
import { applyColumnConfig } from '@/hooks/useColumnConfig'
import type { ColumnConfig } from '@/hooks/useColumnConfig'
import type { ColumnRegistryItem } from './ColumnConfigPopover'
import type { PaymentRequest, StageHistoryEntry } from '@/types'
import { DEPARTMENT_LABELS } from '@/types'

/** Реестр всех возможных десктопных столбцов (без "Действия") */
export const DESKTOP_COLUMN_REGISTRY: ColumnRegistryItem[] = [
  { key: 'requestNumber', title: '№' },
  { key: 'counterpartyName', title: 'Подрядчик' },
  { key: 'siteName', title: 'Объект' },
  { key: 'supplierName', title: 'Поставщик' },
  { key: 'status', title: 'Статус' },
  { key: 'paidStatus', title: 'Оплата' },
  { key: 'invoiceAmount', title: 'Сумма' },
  { key: 'dpNumber', title: 'РП' },
  { key: 'unreadComments', title: 'Новые' },
  { key: 'responsible', title: 'Ответственный' },
  { key: 'createdAt', title: 'Дата' },
  { key: 'days', title: 'Срок' },
  { key: 'omtsDays', title: 'Срок ОМТС' },
  { key: 'approvedAt', title: 'Дата согласования' },
  { key: 'rejectedAt', title: 'Дата отклонения' },
  { key: 'rejectedBy', title: 'Кто отклонил' },
  { key: 'files', title: 'Файлы' },
  { key: 'approval', title: 'Согласование' },
]

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
  statusFilters?: { text: string; value: string }[]
  showOmtsDays?: boolean
  unreadCounts?: Record<string, number>
  isMobile?: boolean
  columnConfig?: ColumnConfig
}

/** Возвращает первые 2 слова из ФИО (fallback на email) */
function getShortName(fullName?: string, email?: string): string | undefined {
  if (fullName) {
    const words = fullName.trim().split(/\s+/)
    return words.slice(0, 2).join(' ')
  }
  return email
}

/** Маппинг событий для тултипа */
const TOOLTIP_EVENT_LABELS: Record<string, string> = {
  approved: 'Согласовано',
  rejected: 'Отклонено',
  revision: 'Отправлено на доработку',
  revision_complete: 'Доработано',
}

/** Формирует содержимое тултипа из stageHistory */
function buildStatusTooltip(stageHistory: StageHistoryEntry[], isCounterparty: boolean): React.ReactNode | null {
  const entries = (stageHistory ?? []).filter(e => e.event !== 'received' && TOOLTIP_EVENT_LABELS[e.event])
  if (entries.length === 0) return null

  return (
    <div style={{ maxWidth: 360 }}>
      {entries.map((entry, idx) => {
        const eventLabel = TOOLTIP_EVENT_LABELS[entry.event]
        const dept = entry.isOmtsRp ? 'ОМТС РП' : (DEPARTMENT_LABELS[entry.department as keyof typeof DEPARTMENT_LABELS] ?? entry.department)
        const date = formatDateShort(entry.at)
        // Для counterparty автор виден только на стадии ОМТС
        const showAuthor = !isCounterparty || entry.stage === 2
        const authorName = showAuthor ? getShortName(entry.userFullName, entry.userEmail) : undefined
        // revision_complete показываем без департамента
        const isRevisionComplete = entry.event === 'revision_complete'

        return (
          <div key={idx} style={{ marginBottom: entry.comment ? 0 : 4 }}>
            <span>
              {!isRevisionComplete && <>{dept} </>}
              {eventLabel}
              {authorName && <> ({authorName})</>}
              {' '}{date}
            </span>
            {entry.comment && (
              <div style={{ paddingLeft: 16, marginBottom: 4, opacity: 0.85 }}>
                Комментарий: {entry.comment}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Формирует пункты мобильного меню действий для строки */
function buildMobileActions(
  record: PaymentRequest,
  props: RequestsTableProps,
) {
  const items: { key: string; label: string; icon: React.ReactNode; danger?: boolean; onClick: () => void }[] = [
    { key: 'view', label: 'Просмотр', icon: <EyeOutlined />, onClick: () => props.onView(record) },
  ]

  if (props.showApprovalActions && props.onApprove) {
    items.push({
      key: 'approve', label: 'Согласовать', icon: <CheckOutlined />,
      onClick: () => props.onApprove!(record.id, ''),
    })
  }

  if (props.showApprovalActions && props.onReject) {
    items.push({
      key: 'reject', label: 'Отклонить', icon: <StopOutlined />, danger: true,
      onClick: () => {}, // обрабатывается через setRejectModalId
    })
  }

  if (props.isCounterpartyUser && props.onWithdraw && !record.withdrawnAt) {
    items.push({
      key: 'withdraw', label: 'Отозвать', icon: <RollbackOutlined />, danger: true,
      onClick: () => {}, // обрабатывается через setWithdrawModalId
    })
  }

  if (props.isCounterpartyUser && props.onResubmit && record.rejectedAt) {
    items.push({
      key: 'resubmit', label: 'Отправить повторно', icon: <RedoOutlined />,
      onClick: () => props.onResubmit!(record),
    })
  }

  if (props.isAdmin && props.onDelete && !record.isDeleted) {
    items.push({
      key: 'delete', label: 'Удалить', icon: <DeleteOutlined />, danger: true,
      onClick: () => props.onDelete!(record.id),
    })
  }

  return items
}

const RequestsTable = (props: RequestsTableProps) => {
  const { message: _message } = App.useApp()
  const {
    requests, isLoading, onView, isCounterpartyUser, onWithdraw, hideCounterpartyColumn,
    statusOptions, onStatusChange, statusChangingId, isAdmin, onDelete, uploadTasks,
    showApprovalActions, onApprove, onReject, showApprovedDate, showRejectedDate,
    totalStages, showDepartmentFilter, rejectionDepartments, onResubmit,
    showResponsibleColumn, canAssignResponsible, omtsUsers, onAssignResponsible, responsibleFilter,
    statusFilters, showOmtsDays, unreadCounts, isMobile,
  } = props

  const [rejectModalId, setRejectModalId] = useState<string | null>(null)
  const [withdrawModalId, setWithdrawModalId] = useState<string | null>(null)

  const filteredRequests = useMemo(() => {
    if (responsibleFilter === 'assigned') return requests.filter(r => r.assignedUserId !== null)
    if (responsibleFilter === 'unassigned') return requests.filter(r => r.assignedUserId === null)
    return requests
  }, [requests, responsibleFilter])

  // --- Мобильные столбцы ---
  const mobileColumns: Record<string, unknown>[] = useMemo(() => {
    if (!isMobile) return []

    const cols: Record<string, unknown>[] = [
      {
        title: '№', dataIndex: 'requestNumber', key: 'requestNumber', width: 50,
        render: (requestNumber: string) => extractRequestNumber(requestNumber),
      },
    ]

    if (!hideCounterpartyColumn) {
      cols.push({
        title: 'Подрядчик', dataIndex: 'counterpartyName', key: 'counterpartyName',
        ellipsis: true,
        render: (name: string | undefined) => <span style={{ fontSize: 12 }}>{name ?? '—'}</span>,
      })
    }

    cols.push(
      {
        title: 'Объект', dataIndex: 'siteName', key: 'siteName',
        ellipsis: true,
        render: (name: string | undefined) => <span style={{ fontSize: 12 }}>{name ?? '—'}</span>,
      },
      {
        title: 'Статус', key: 'status', width: 100,
        render: (_: unknown, record: PaymentRequest) => {
          const tooltipContent = buildStatusTooltip(record.stageHistory, !!isCounterpartyUser)
          const tag = <Tag color={record.statusColor ?? 'default'} style={{ fontSize: 11, lineHeight: 1.3, whiteSpace: 'pre-line' }}>{record.statusName}</Tag>
          if (!tooltipContent) return tag
          return <Tooltip title={tooltipContent} mouseEnterDelay={0.5}>{tag}</Tooltip>
        },
      },
      {
        title: 'Сумма РП', key: 'invoiceAmount', width: 100, align: 'right' as const,
        render: (_: unknown, record: PaymentRequest) => {
          const str = record.invoiceAmount != null
            ? record.invoiceAmount.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
            : '—'
          return (
            <span style={{ backgroundColor: '#1d3557', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 12, whiteSpace: 'nowrap' }}>
              {str} ₽
            </span>
          )
        },
      },
      {
        title: '', key: 'mobileActions', width: 40, align: 'center' as const,
        render: (_: unknown, record: PaymentRequest) => {
          const items = buildMobileActions(record, props)
          return (
            <Dropdown
              menu={{
                items: items.map((item) => ({
                  ...item,
                  onClick: () => {
                    if (item.key === 'reject') {
                      setRejectModalId(record.id)
                    } else if (item.key === 'withdraw') {
                      setWithdrawModalId(record.id)
                    } else {
                      item.onClick()
                    }
                  },
                })),
              }}
              trigger={['click']}
              placement="bottomRight"
            >
              <Button type="text" icon={<MoreOutlined />} size="small" onClick={(e) => e.stopPropagation()} />
            </Dropdown>
          )
        },
      },
    )

    return cols
  }, [isMobile, hideCounterpartyColumn, props])

  // --- Десктопные столбцы ---
  const desktopColumns: Record<string, unknown>[] = useMemo(() => {
    if (isMobile) return []

    const cols: Record<string, unknown>[] = [
      {
        title: '№', dataIndex: 'requestNumber', key: 'requestNumber', width: 60,
        sorter: (a: PaymentRequest, b: PaymentRequest) => parseInt(extractRequestNumber(a.requestNumber), 10) - parseInt(extractRequestNumber(b.requestNumber), 10),
        render: (requestNumber: string) => extractRequestNumber(requestNumber),
      },
    ]

    if (!hideCounterpartyColumn) {
      cols.push({
        title: 'Подрядчик', dataIndex: 'counterpartyName', key: 'counterpartyName', width: 180, ellipsis: true,
        sorter: (a: PaymentRequest, b: PaymentRequest) => (a.counterpartyName || '').localeCompare(b.counterpartyName || '', 'ru'),
      })
    }

    cols.push(
      {
        title: 'Объект', dataIndex: 'siteName', key: 'siteName', width: 160,
        sorter: (a: PaymentRequest, b: PaymentRequest) => (a.siteName || '').localeCompare(b.siteName || '', 'ru'),
        render: (name: string | undefined) => name ?? '—',
      },
      {
        title: 'Поставщик', dataIndex: 'supplierName', key: 'supplierName', width: 160,
        sorter: (a: PaymentRequest, b: PaymentRequest) => (a.supplierName || '').localeCompare(b.supplierName || '', 'ru'),
        render: (name: string | undefined) => name ?? '—',
      },
      {
        title: 'Статус', key: 'status', width: 150,
        sorter: (a: PaymentRequest, b: PaymentRequest) => (a.statusName || '').localeCompare(b.statusName || '', 'ru'),
        filters: statusFilters,
        onFilter: (value: unknown, record: PaymentRequest) => record.statusId === value,
        render: (_: unknown, record: PaymentRequest) => {
          const tooltipContent = buildStatusTooltip(record.stageHistory, !!isCounterpartyUser)
          const tag = <Tag color={record.statusColor ?? 'default'} style={{ whiteSpace: 'pre-line', lineHeight: 1.3 }}>{record.statusName}</Tag>
          if (!tooltipContent) return tag
          return <Tooltip title={tooltipContent} mouseEnterDelay={0.5}>{tag}</Tooltip>
        },
      },
      {
        title: 'Оплата', key: 'paidStatus', width: 110,
        sorter: (a: PaymentRequest, b: PaymentRequest) => (a.paidStatusName || '').localeCompare(b.paidStatusName || '', 'ru'),
        render: (_: unknown, record: PaymentRequest) => <Tag color={record.paidStatusColor ?? 'default'} style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>{record.paidStatusName ?? '—'}</Tag>,
      },
      {
        title: (
          <div style={{ textAlign: 'center', lineHeight: 1.3 }}>
            <div>Сумма РП</div>
            <div style={{ borderBottom: '1px solid #d9d9d9', margin: '2px 0' }} />
            <div>Сумма оплачено</div>
          </div>
        ),
        key: 'invoiceAmount', width: 180, align: 'right' as const,
        sorter: (a: PaymentRequest, b: PaymentRequest) => (a.invoiceAmount ?? 0) - (b.invoiceAmount ?? 0),
        render: (_: unknown, record: PaymentRequest) => {
          const invoiceStr = record.invoiceAmount != null
            ? record.invoiceAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '—'
          const paidStr = record.totalPaid > 0
            ? record.totalPaid.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '0,00'
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
              <span style={{ backgroundColor: '#1d3557', color: '#fff', borderRadius: 4, padding: '1px 8px', fontSize: 13, whiteSpace: 'nowrap' }}>
                {invoiceStr} ₽
              </span>
              <span style={{ backgroundColor: '#1b5e20', color: '#fff', borderRadius: 4, padding: '1px 8px', fontSize: 13, whiteSpace: 'nowrap' }}>
                {paidStr} ₽
              </span>
            </div>
          )
        },
      },
      {
        title: 'РП', dataIndex: 'dpNumber', key: 'dpNumber', width: 120,
        sorter: (a: PaymentRequest, b: PaymentRequest) => (a.dpNumber || '').localeCompare(b.dpNumber || '', 'ru'),
        render: (value: string | null) => value ?? '—',
      },
    )

    if (unreadCounts) {
      cols.push({
        title: (
          <div style={{ textAlign: 'center', lineHeight: 1.3 }}>
            <div>Новые</div>
            <MessageOutlined style={{ fontSize: 14 }} />
          </div>
        ),
        key: 'unreadComments',
        width: 65,
        align: 'center' as const,
        sorter: (a: PaymentRequest, b: PaymentRequest) => (unreadCounts[a.id] || 0) - (unreadCounts[b.id] || 0),
        render: (_: unknown, record: PaymentRequest) => {
          const count = unreadCounts[record.id] || 0
          if (count === 0) return null
          return <Badge count={count} style={{ backgroundColor: '#1677ff' }} />
        },
      })
    }

    if (showResponsibleColumn) {
      cols.push({
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

    cols.push(
      {
        title: 'Дата', dataIndex: 'createdAt', key: 'createdAt', width: 100,
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

    if (showOmtsDays) {
      cols.push({
        title: 'Срок ОМТС', key: 'omtsDays', width: 80,
        sorter: (a: PaymentRequest, b: PaymentRequest) => {
          if (!a.omtsEnteredAt && !b.omtsEnteredAt) return 0
          if (!a.omtsEnteredAt) return 1
          if (!b.omtsEnteredAt) return -1
          return calculateDays(a.omtsEnteredAt, a.omtsApprovedAt) - calculateDays(b.omtsEnteredAt, b.omtsApprovedAt)
        },
        render: (_: unknown, record: PaymentRequest) => {
          if (!record.omtsEnteredAt) return <span style={{ color: '#bfbfbf' }}>—</span>
          return <span>{calculateDays(record.omtsEnteredAt, record.omtsApprovedAt)}</span>
        },
      })
    }

    if (showApprovedDate) {
      cols.push({
        title: 'Дата согласования', dataIndex: 'approvedAt', key: 'approvedAt', width: 100,
        sorter: (a: PaymentRequest, b: PaymentRequest) => new Date(a.approvedAt ?? '').getTime() - new Date(b.approvedAt ?? '').getTime(),
        render: (date: string | null) => formatDateShort(date),
      })
    }

    if (showRejectedDate) {
      cols.push({
        title: 'Дата отклонения', dataIndex: 'rejectedAt', key: 'rejectedAt', width: 100,
        sorter: (a: PaymentRequest, b: PaymentRequest) => new Date(a.rejectedAt ?? '').getTime() - new Date(b.rejectedAt ?? '').getTime(),
        render: (date: string | null) => formatDateShort(date),
      })
    }

    if (showDepartmentFilter && rejectionDepartments) {
      cols.push({ title: 'Кто отклонил', key: 'rejectedBy', width: 180, filters: rejectionDepartments, onFilter: () => true })
    }

    cols.push({
      title: 'Файлы', key: 'files', width: 70,
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
      cols.push({
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

    cols.push({
      title: 'Действия', key: 'actions', width: showApprovalActions ? 140 : 126, fixed: 'right' as const,
      render: (_: unknown, record: PaymentRequest) => (
        <Space>
          <Tooltip title="Просмотр"><Button icon={<EyeOutlined />} size="small" onClick={() => onView(record)} /></Tooltip>
          {showApprovalActions && (
            <>
              <Tooltip title="Согласовать">
                <Popconfirm title="Согласование заявки" description="Подтвердите корректность всех файлов и условий" onConfirm={() => onApprove?.(record.id, '')} okText="Согласовать" cancelText="Отмена">
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

    return cols
  }, [
    isMobile, hideCounterpartyColumn, statusFilters, unreadCounts,
    showResponsibleColumn, canAssignResponsible, omtsUsers, onAssignResponsible,
    showOmtsDays, showApprovedDate, showRejectedDate, showDepartmentFilter, rejectionDepartments,
    isCounterpartyUser, totalStages, uploadTasks, showApprovalActions,
    onView, onApprove, onWithdraw, onResubmit, onDelete, isAdmin, statusOptions, onStatusChange, statusChangingId, onReject,
  ])

  // Применяем пользовательский конфиг к десктопным столбцам
  const configuredDesktopColumns = useMemo(() => {
    if (isMobile || !props.columnConfig) return desktopColumns
    return applyColumnConfig(desktopColumns, props.columnConfig)
  }, [desktopColumns, props.columnConfig, isMobile])

  const columns = isMobile ? mobileColumns : configuredDesktopColumns

  const { containerRef, paginationRef, scrollY } = useTableScrollY([filteredRequests.length])
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // Сброс страницы при смене данных
  useEffect(() => {
    setCurrentPage(1)
  }, [filteredRequests.length])

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredRequests.slice(start, start + pageSize)
  }, [filteredRequests, currentPage, pageSize])

  return (
    <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Table
        columns={columns as any}
        dataSource={paginatedData}
        rowKey="id"
        loading={isLoading}
        scroll={isMobile ? { y: scrollY } : { x: 1700, y: scrollY }}
        pagination={false}
        size={isMobile ? 'small' : undefined}
        onRow={(record: PaymentRequest) => ({
          onClick: (e: React.MouseEvent) => {
            const target = e.target as HTMLElement
            if (target.closest('button, a, .ant-btn, .ant-select, .ant-popconfirm, .ant-popover, .ant-dropdown')) return
            onView(record)
          },
          style: { cursor: 'pointer' },
        })}
        rowClassName={(record: PaymentRequest) => {
          const classes: string[] = ['clickable-row']
          if (uploadTasks?.[record.id]?.status === 'error') classes.push('row-upload-error')
          if (record.isDeleted) classes.push('row-deleted')
          return classes.join(' ')
        }}
      />
      <div ref={paginationRef} style={{ display: 'flex', justifyContent: 'flex-end', padding: isMobile ? '8px 0 60px 0' : '12px 0', flexShrink: 0 }}>
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={filteredRequests.length}
          showSizeChanger={!isMobile}
          pageSizeOptions={[10, 20, 50, 100]}
          onChange={(page, size) => {
            setCurrentPage(page)
            setPageSize(size)
          }}
          showTotal={isMobile ? undefined : (total) => `${total} / стр.`}
          size={isMobile ? 'small' : undefined}
          simple={isMobile}
        />
      </div>
      <style>{`
        .clickable-row:hover td { background-color: #e6f4ff !important; }
        .row-upload-error td { background-color: #fff1f0 !important; }
        .row-upload-error:hover td { background-color: #ffccc7 !important; }
        .row-deleted td { opacity: 0.45; }
      `}</style>

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
    </div>
  )
}

export default RequestsTable
