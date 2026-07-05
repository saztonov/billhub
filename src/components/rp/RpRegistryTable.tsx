import { useMemo, useState } from 'react'
import { Table, Tag, Space, Button, Tooltip, Typography, Badge } from 'antd'
import { EditOutlined, StopOutlined, DeleteOutlined, PaperClipOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { formatDateShort } from '@/utils/requestFormatters'
import type { RpLetter, RpPaymentStatus } from '@/types'

const { Text } = Typography

const PAYMENT_STATUS_META: Record<RpPaymentStatus, { label: string; color: string }> = {
  paid: { label: 'Оплачено', color: 'green' },
  partial: { label: 'Частично', color: 'orange' },
  unpaid: { label: 'Не оплачено', color: 'default' },
}

const fmtAmount = (v: number) => `${(v ?? 0).toLocaleString('ru-RU')} ₽`

interface RpRegistryTableProps {
  letters: RpLetter[]
  isLoading: boolean
  /** Управление РП (admin / ОМТС РП). При false реестр read-only: без действий и кнопок письма. */
  canManage: boolean
  onOpenRequest: (requestId: string) => void
  /** «Создать письмо» (uploading) / «Повторить» (failed) — постановка в очередь */
  onRetryLetter: (id: string) => void
  /** Правка текста письма */
  onEdit: (letter: RpLetter) => void
  /** Аннулировать РП (удаляет письмо в PayHub) */
  onAnnul: (letter: RpLetter) => void
  /** Удалить РП (удаляет письмо в PayHub) */
  onDelete: (letter: RpLetter) => void
  /** Открыть модалку файлов РП (вложения PayHub + служебные) */
  onFiles: (letter: RpLetter) => void
}

/** Колонка «Письмо»: ссылка на PayHub либо статус синхронизации с действием. */
const LetterCell = ({
  letter,
  onRetryLetter,
  canManage,
}: {
  letter: RpLetter
  onRetryLetter: (id: string) => void
  canManage: boolean
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
          {canManage && (
            <Button size="small" onClick={() => onRetryLetter(letter.id)}>
              Создать письмо
            </Button>
          )}
        </Space>
      )
    case 'failed':
      return (
        <Space size={4}>
          <Tooltip title={letter.payhubLetterError ?? undefined}>
            <Tag color="error">ошибка</Tag>
          </Tooltip>
          {canManage && (
            <Button size="small" onClick={() => onRetryLetter(letter.id)}>
              Повторить
            </Button>
          )}
        </Space>
      )
  }
}

/** Колонка «Статус»: платёжный/аннулирование (1 строка) + синхронизация (2 строка, авто). */
const StatusCell = ({ letter }: { letter: RpLetter }) => {
  const annulled = letter.status === 'annulled'
  const pay = PAYMENT_STATUS_META[letter.paymentStatus] ?? PAYMENT_STATUS_META.unpaid
  const synced = letter.payhubLetterStatus === 'synced'
  return (
    <Space direction="vertical" size={2}>
      {annulled ? <Tag color="red">Аннулировано</Tag> : <Tag color={pay.color}>{pay.label}</Tag>}
      <Tag color={synced ? 'green' : 'default'}>{synced ? 'Синхронизировано' : 'Черновик'}</Tag>
    </Space>
  )
}

/** Таблица реестра распределительных писем. */
const RpRegistryTable = ({
  letters,
  isLoading,
  canManage,
  onOpenRequest,
  onRetryLetter,
  onEdit,
  onAnnul,
  onDelete,
  onFiles,
}: RpRegistryTableProps) => {
  // Пагинация — в состоянии, чтобы столбец «№» нумеровал сквозь страницы.
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const columns = useMemo<ColumnsType<RpLetter>>(() => {
    const cols: ColumnsType<RpLetter> = [
      {
        title: '№',
        key: 'index',
        width: 42,
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
        width: 100,
        render: (_: unknown, r: RpLetter) => (
          <Space direction="vertical" size={0}>
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
        width: 95,
        render: (_: unknown, r: RpLetter) => (
          <LetterCell letter={r} onRetryLetter={onRetryLetter} canManage={canManage} />
        ),
      },
      {
        title: 'Статус',
        key: 'status',
        width: 150,
        render: (_: unknown, r: RpLetter) => <StatusCell letter={r} />,
      },
    ]

    // Колонка действий управления РП — только admin / ОМТС РП; иначе реестр read-only.
    if (canManage) {
      cols.push({
        title: 'Действия',
        key: 'actions',
        width: 150,
        fixed: 'right',
        render: (_: unknown, r: RpLetter) => {
          const annulled = r.status === 'annulled'
          const canAnnul = !annulled && r.paymentStatus === 'unpaid'
          return (
            <Space size={0}>
              <Tooltip title="Файлы РП">
                <Badge count={r.filesCount} size="small" color="blue" offset={[-4, 4]}>
                  <Button
                    type="text"
                    size="small"
                    icon={<PaperClipOutlined />}
                    onClick={() => onFiles(r)}
                  />
                </Badge>
              </Tooltip>
              <Tooltip title="Редактировать письмо">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  disabled={annulled}
                  onClick={() => onEdit(r)}
                />
              </Tooltip>
              <Tooltip
                title={
                  canAnnul
                    ? 'Аннулировать'
                    : annulled
                      ? 'Уже аннулирована'
                      : 'Аннулировать можно только полностью неоплаченную РП'
                }
              >
                <Button
                  type="text"
                  size="small"
                  icon={<StopOutlined />}
                  disabled={!canAnnul}
                  onClick={() => onAnnul(r)}
                />
              </Tooltip>
              <Tooltip title="Удалить РП">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => onDelete(r)}
                />
              </Tooltip>
            </Space>
          )
        },
      })
    }

    return cols
  }, [onOpenRequest, onRetryLetter, onEdit, onAnnul, onDelete, onFiles, page, pageSize, canManage])

  return (
    <Table
      columns={columns}
      dataSource={letters}
      rowKey="id"
      loading={isLoading}
      size="small"
      scroll={{ x: canManage ? 1627 : 1477, y: 'calc(100vh - 320px)' }}
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
