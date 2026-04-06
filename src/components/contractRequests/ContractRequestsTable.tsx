import { useState, useMemo } from 'react'
import { Table, Tag, Button, Dropdown, Pagination, Flex, Popconfirm } from 'antd'
import { EyeOutlined, DeleteOutlined, MoreOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { ContractRequest } from '@/types'
import { CONTRACT_SUBJECT_LABELS, REVISION_TARGET_LABELS } from '@/types'
import useIsMobile from '@/hooks/useIsMobile'
import dayjs from 'dayjs'

/** Формат даты создания заявки в столбце "№" */
function formatShortDate(iso?: string | null): string {
  if (!iso) return ''
  const d = dayjs(iso)
  return d.isValid() ? d.format('DD.MM.YY') : ''
}

/** Формат блока договора в столбце "Договор" */
function formatContractCell(num?: string | null, date?: string | null): string {
  const d = date ? dayjs(date) : null
  const dateStr = d && d.isValid() ? d.format('DD.MM.YYYY') : ''
  if (num && dateStr) return `${num} от ${dateStr}`
  if (num) return num
  if (dateStr) return `от ${dateStr}`
  return '—'
}
interface ContractRequestsTableProps {
  requests: ContractRequest[]
  isLoading: boolean
  onView: (record: ContractRequest) => void
  onDelete: (id: string) => Promise<void>
  isAdmin: boolean
  isCounterpartyUser: boolean
}

const ContractRequestsTable = ({
  requests,
  isLoading,
  onView,
  onDelete,
  isAdmin,
  isCounterpartyUser,
}: ContractRequestsTableProps) => {
  const isMobile = useIsMobile()
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)

  // Сброс страницы при изменении данных
  useMemo(() => { setCurrentPage(1) }, [requests.length])

  /** Рендер статуса с учётом revision_targets */
  const renderStatus = (record: ContractRequest) => {
    if (record.statusCode === 'on_revision' && record.revisionTargets.length > 0) {
      return (
        <Flex vertical gap={4}>
          {record.revisionTargets.map((target) => (
            <Tag key={target} color="orange" style={{ margin: 0 }}>
              {REVISION_TARGET_LABELS[target]}
            </Tag>
          ))}
        </Flex>
      )
    }
    return <Tag color={record.statusColor || undefined} style={{ whiteSpace: 'normal' }}>{record.statusName}</Tag>
  }

  const desktopColumns: ColumnsType<ContractRequest> = [
    {
      title: '№',
      dataIndex: 'requestNumber',
      key: 'requestNumber',
      width: 110,
      sorter: (a, b) => a.requestNumber.localeCompare(b.requestNumber),
      render: (_: string, record: ContractRequest) => (
        <div>
          <div>{record.requestNumber}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{formatShortDate(record.createdAt)}</div>
        </div>
      ),
    },
    ...(!isCounterpartyUser ? [{
      title: 'Подрядчик',
      dataIndex: 'counterpartyName',
      key: 'counterpartyName',
      width: 180,
      sorter: (a: ContractRequest, b: ContractRequest) => (a.counterpartyName ?? '').localeCompare(b.counterpartyName ?? ''),
      render: (_: string | undefined, record: ContractRequest) => record.counterpartyName ? (
        <div>
          <div>{record.counterpartyName}</div>
          {record.counterpartyInn && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{record.counterpartyInn}</div>}
        </div>
      ) : '—',
    }] : []),
    {
      title: 'Объект',
      dataIndex: 'siteName',
      key: 'siteName',
      width: 180,
      ellipsis: true,
      sorter: (a, b) => (a.siteName ?? '').localeCompare(b.siteName ?? ''),
    },
    {
      title: 'Поставщик',
      dataIndex: 'supplierName',
      key: 'supplierName',
      width: 180,
      sorter: (a, b) => (a.supplierName ?? '').localeCompare(b.supplierName ?? ''),
      render: (_: string | undefined, record: ContractRequest) => record.supplierName ? (
        <div>
          <div>{record.supplierName}</div>
          {record.supplierInn && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{record.supplierInn}</div>}
        </div>
      ) : '—',
    },
    {
      title: 'Предмет договора',
      key: 'subjectType',
      width: 200,
      render: (_, record) => (
        <div>
          <div>{CONTRACT_SUBJECT_LABELS[record.subjectType] ?? record.subjectType}</div>
          {record.subjectDetail && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {record.subjectDetail}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Договор',
      key: 'contract',
      width: 200,
      render: (_, record) => formatContractCell(record.contractNumber, record.contractSigningDate),
    },
    {
      title: 'Статус',
      key: 'status',
      width: 180,
      render: (_, record) => renderStatus(record),
    },
    {
      title: 'Ответственный',
      key: 'responsible',
      width: 160,
      ellipsis: true,
      sorter: (a, b) => (a.responsibleUserFullName ?? '').localeCompare(b.responsibleUserFullName ?? '', 'ru'),
      render: (_, record) => record.responsibleUserFullName || '—',
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <Flex gap={4}>
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={(e) => { e.stopPropagation(); onView(record) }}
          />
          {isAdmin && (
            <Popconfirm
              title="Удалить заявку?"
              onConfirm={(e) => { e?.stopPropagation(); onDelete(record.id) }}
              onCancel={(e) => e?.stopPropagation()}
            >
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={(e) => e.stopPropagation()}
              />
            </Popconfirm>
          )}
        </Flex>
      ),
    },
  ]

  const mobileColumns: ColumnsType<ContractRequest> = [
    {
      title: '№',
      dataIndex: 'requestNumber',
      key: 'requestNumber',
      width: 90,
    },
    {
      title: 'Объект',
      dataIndex: 'siteName',
      key: 'siteName',
      ellipsis: true,
    },
    {
      title: 'Статус',
      key: 'status',
      width: 140,
      render: (_, record) => renderStatus(record),
    },
    {
      title: '',
      key: 'actions',
      width: 40,
      render: (_, record) => {
        const items = [
          { key: 'view', label: 'Просмотр', onClick: () => onView(record) },
          ...(isAdmin ? [{
            key: 'delete',
            label: 'Удалить',
            danger: true as const,
            onClick: () => onDelete(record.id),
          }] : []),
        ]
        return (
          <Dropdown menu={{ items }} trigger={['click']}>
            <Button
              size="small"
              icon={<MoreOutlined />}
              onClick={(e) => e.stopPropagation()}
            />
          </Dropdown>
        )
      },
    },
  ]

  const columns = isMobile ? mobileColumns : desktopColumns

  /** Пагинация на клиенте */
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return requests.slice(start, start + pageSize)
  }, [requests, currentPage, pageSize])

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Table
          columns={columns}
          dataSource={paginatedData}
          rowKey="id"
          loading={isLoading}
          pagination={false}
          size="small"
          scroll={isMobile ? undefined : { x: 1450 }}
          rowClassName={(record) => record.isDeleted ? 'deleted-row' : ''}
          onRow={(record) => ({
            onClick: (e) => {
              const target = e.target as HTMLElement
              if (target.closest('button, a, .ant-select, .ant-dropdown, .ant-popconfirm, .ant-input, .ant-picker')) return
              onView(record)
            },
            style: { cursor: 'pointer', opacity: record.isDeleted ? 0.45 : 1 },
          })}
        />
      </div>
      <Flex justify="flex-end" style={{ padding: '8px 0' }}>
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={requests.length}
          onChange={(page, size) => { setCurrentPage(page); setPageSize(size) }}
          showSizeChanger
          pageSizeOptions={['10', '20', '50', '100', '200']}
          size="small"
          simple={isMobile}
        />
      </Flex>
    </div>
  )
}

export default ContractRequestsTable
