import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Table, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import type { SgnlExportErrorRow } from '@/types/sgnl'

const { Text } = Typography

interface SgnlErrorsTableProps {
  /** Меняется после запуска выгрузки — повод перечитать список */
  refreshKey: number
}

/** Файлы, которые не удалось выгрузить в SIGNAL (повторяются следующим прогоном) */
const SgnlErrorsTable = ({ refreshKey }: SgnlErrorsTableProps) => {
  const [rows, setRows] = useState<SgnlExportErrorRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ errors: SgnlExportErrorRow[] }>('/api/sgnl/errors?limit=200')
      setRows(data.errors ?? [])
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: `Ошибка загрузки ошибок выгрузки SIGNAL: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`,
        component: 'SgnlErrorsTable',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const columns = [
    {
      title: 'Заявка',
      dataIndex: 'requestNumber',
      key: 'requestNumber',
      width: 90,
      render: (v: string | null) => v ?? '—',
    },
    { title: 'Объект', dataIndex: 'siteName', key: 'siteName', width: 180 },
    {
      title: 'Файл / путь',
      key: 'path',
      render: (_: unknown, r: SgnlExportErrorRow) => (
        <div>
          <div>{r.targetName}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.targetPath}
          </Text>
        </div>
      ),
    },
    { title: 'Попыток', dataIndex: 'attempts', key: 'attempts', width: 90 },
    {
      title: 'Ошибка',
      dataIndex: 'lastError',
      key: 'lastError',
      render: (v: string | null) => <Text type="danger">{v ?? '—'}</Text>,
    },
    {
      title: 'Когда',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 160,
      render: (v: string) => new Date(v).toLocaleString('ru-RU'),
    },
  ]

  return (
    <Card
      title={`Ошибки выгрузки (${rows.length})`}
      extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={load} />}
    >
      <Table
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        scroll={{ x: 900 }}
        locale={{ emptyText: 'Ошибок нет' }}
      />
    </Card>
  )
}

export default SgnlErrorsTable
