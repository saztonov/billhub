import { useMemo } from 'react'
import { Table, Tag, Space, Select, Button } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { formatDateShort } from '@/utils/requestFormatters'
import type { RpLetter, RpPaymentStatus } from '@/types'

/** Опции статуса РП (собственный workflow). */
export const RP_STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'Черновик', value: 'draft' },
  { label: 'В работе', value: 'in_progress' },
  { label: 'Отправлено в заказ', value: 'ordered' },
  { label: 'Завершено', value: 'done' },
]

const PAYMENT_STATUS_META: Record<RpPaymentStatus, { label: string; color: string }> = {
  paid: { label: 'Оплачено', color: 'green' },
  partial: { label: 'Частично', color: 'orange' },
  unpaid: { label: 'Не оплачено', color: 'default' },
}

const fmtAmount = (v: number) => `${(v ?? 0).toLocaleString('ru-RU')} ₽`

interface RpRegistryTableProps {
  letters: RpLetter[]
  isLoading: boolean
  onOpenRequest: (requestId: string) => void
  onStatusChange: (id: string, status: string) => void
}

/** Таблица реестра распределительных писем. */
const RpRegistryTable = ({
  letters,
  isLoading,
  onOpenRequest,
  onStatusChange,
}: RpRegistryTableProps) => {
  const columns = useMemo<ColumnsType<RpLetter>>(
    () => [
      {
        title: 'Номер',
        dataIndex: 'number',
        key: 'number',
        width: 120,
        fixed: 'left',
      },
      {
        title: 'Дата создания',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 120,
        render: (v: string) => formatDateShort(v),
      },
      {
        title: 'Сумма',
        dataIndex: 'totalAmount',
        key: 'totalAmount',
        width: 140,
        render: (v: number) => fmtAmount(v),
      },
      {
        title: 'Заявки',
        key: 'requests',
        width: 200,
        render: (_: unknown, r: RpLetter) => (
          <Space size={[4, 4]} wrap>
            {r.requests.map((req) => (
              <Button
                key={req.id}
                type="link"
                size="small"
                style={{ padding: 0, height: 'auto' }}
                onClick={() => onOpenRequest(req.id)}
              >
                {req.requestNumber}
              </Button>
            ))}
          </Space>
        ),
      },
      {
        title: 'Поставщик',
        key: 'supplier',
        width: 200,
        render: (_: unknown, r: RpLetter) => (
          <div>
            <div>{r.supplierName}</div>
            <div style={{ fontSize: 12, color: '#888' }}>ИНН: {r.supplierInn}</div>
          </div>
        ),
      },
      {
        title: 'Подрядчик',
        key: 'counterparty',
        width: 200,
        render: (_: unknown, r: RpLetter) => (
          <div>
            <div>{r.counterpartyName}</div>
            <div style={{ fontSize: 12, color: '#888' }}>ИНН: {r.counterpartyInn}</div>
          </div>
        ),
      },
      {
        title: 'Описание',
        dataIndex: 'description',
        key: 'description',
        width: 260,
        ellipsis: true,
      },
      {
        title: 'Статус оплаты',
        dataIndex: 'paymentStatus',
        key: 'paymentStatus',
        width: 130,
        render: (v: RpPaymentStatus) => {
          const meta = PAYMENT_STATUS_META[v] ?? PAYMENT_STATUS_META.unpaid
          return <Tag color={meta.color}>{meta.label}</Tag>
        },
      },
      {
        title: 'Статус РП',
        dataIndex: 'status',
        key: 'status',
        width: 170,
        render: (v: string, r: RpLetter) => (
          <Select
            value={v}
            options={RP_STATUS_OPTIONS}
            size="small"
            style={{ width: '100%' }}
            onChange={(next) => onStatusChange(r.id, next)}
          />
        ),
      },
    ],
    [onOpenRequest, onStatusChange],
  )

  return (
    <Table
      columns={columns}
      dataSource={letters}
      rowKey="id"
      loading={isLoading}
      size="small"
      scroll={{ x: 1540, y: 'calc(100vh - 320px)' }}
      pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }}
    />
  )
}

export default RpRegistryTable
