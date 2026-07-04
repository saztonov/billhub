import { useMemo, useState } from 'react'
import { Table, Tag, Space, Select, Button, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { formatDateShort } from '@/utils/requestFormatters'
import type { RpLetter, RpPaymentStatus } from '@/types'

const { Text } = Typography

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
  /** «Создать письмо» (uploading) / «Повторить» (failed) — постановка в очередь */
  onRetryLetter: (id: string) => void
}

/** Колонка «Письмо»: ссылка на PayHub либо статус синхронизации с действием. */
const LetterCell = ({
  letter,
  onRetryLetter,
}: {
  letter: RpLetter
  onRetryLetter: (id: string) => void
}) => {
  const status = letter.payhubLetterStatus
  if (status === null) return <Text type="secondary">—</Text>
  switch (status) {
    case 'synced':
      return letter.payhubLetterUrl ? (
        <a href={letter.payhubLetterUrl} target="_blank" rel="noopener noreferrer">
          Открыть
        </a>
      ) : (
        <Tag color="green">создано</Tag>
      )
    case 'pending':
      return (
        <Tooltip title={letter.payhubLetterError ?? undefined}>
          <Tag color="processing">создаётся…</Tag>
        </Tooltip>
      )
    case 'waiting_config':
      return (
        <Tooltip title={letter.payhubLetterError ?? 'Ожидание настройки PayHub'}>
          <Tag color="warning">ждёт настройки</Tag>
        </Tooltip>
      )
    case 'uploading':
      return (
        <Space size={4}>
          <Tooltip title="Загрузка файлов не была завершена">
            <Tag color="orange">файлы не догружены</Tag>
          </Tooltip>
          <Button size="small" onClick={() => onRetryLetter(letter.id)}>
            Создать письмо
          </Button>
        </Space>
      )
    case 'failed':
      return (
        <Space size={4}>
          <Tooltip title={letter.payhubLetterError ?? undefined}>
            <Tag color="error">ошибка</Tag>
          </Tooltip>
          <Button size="small" onClick={() => onRetryLetter(letter.id)}>
            Повторить
          </Button>
        </Space>
      )
  }
}

/** Таблица реестра распределительных писем. */
const RpRegistryTable = ({
  letters,
  isLoading,
  onOpenRequest,
  onStatusChange,
  onRetryLetter,
}: RpRegistryTableProps) => {
  // Пагинация — в состоянии, чтобы столбец «№» нумеровал сквозь страницы.
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const columns = useMemo<ColumnsType<RpLetter>>(
    () => [
      {
        title: '№',
        key: 'index',
        width: 60,
        fixed: 'left',
        render: (_: unknown, __: RpLetter, index: number) => (page - 1) * pageSize + index + 1,
      },
      {
        // Основной номер — рег.номер письма PayHub; у черновика пусто.
        // Локальный номер РП остаётся внутренним идентификатором (вторая строка).
        title: 'Номер',
        key: 'number',
        width: 170,
        fixed: 'left',
        render: (_: unknown, r: RpLetter) => (
          <div>
            <div>{r.payhubLetterRegNumber ?? <Text type="secondary">—</Text>}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {r.number}
            </Text>
          </div>
        ),
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
        title: 'Письмо',
        key: 'letter',
        width: 190,
        render: (_: unknown, r: RpLetter) => (
          <LetterCell letter={r} onRetryLetter={onRetryLetter} />
        ),
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
    [onOpenRequest, onStatusChange, onRetryLetter, page, pageSize],
  )

  return (
    <Table
      columns={columns}
      dataSource={letters}
      rowKey="id"
      loading={isLoading}
      size="small"
      scroll={{ x: 1840, y: 'calc(100vh - 320px)' }}
      pagination={{
        current: page,
        pageSize,
        showSizeChanger: true,
        pageSizeOptions: [10, 20, 50, 100],
        onChange: (p, ps) => {
          setPage(p)
          setPageSize(ps)
        },
      }}
    />
  )
}

export default RpRegistryTable
