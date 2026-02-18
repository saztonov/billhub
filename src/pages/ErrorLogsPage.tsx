import { useEffect, useState } from 'react'
import {
  Table,
  Button,
  Space,
  Select,
  DatePicker,
  Tag,
  Popconfirm,
  InputNumber,
  App,
  Typography,
} from 'antd'
import { ReloadOutlined, DeleteOutlined } from '@ant-design/icons'
import { useErrorLogStore } from '@/store/errorLogStore'
import type { ErrorLog, ErrorLogType } from '@/types'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'

const { RangePicker } = DatePicker
const { Text } = Typography

// Маппинг типов ошибок для UI
const ERROR_TYPE_CONFIG: Record<ErrorLogType, { label: string; color: string }> = {
  js_error: { label: 'JS', color: 'red' },
  unhandled_rejection: { label: 'Promise', color: 'orange' },
  react_error: { label: 'React', color: 'volcano' },
  api_error: { label: 'API', color: 'blue' },
}

const ERROR_TYPE_OPTIONS = Object.entries(ERROR_TYPE_CONFIG).map(([value, config]) => ({
  value,
  label: config.label,
}))

const ErrorLogsPage = () => {
  const { message } = App.useApp()
  const [deleteDays, setDeleteDays] = useState<number>(30)

  const {
    logs,
    total,
    isLoading,
    page,
    pageSize,
    filters,
    setPage,
    setPageSize,
    setFilters,
    fetchLogs,
    deleteOldLogs,
  } = useErrorLogStore()

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs, page, pageSize, filters])

  const handleTypeFilterChange = (errorTypes: ErrorLogType[]) => {
    setFilters({ ...filters, errorTypes })
  }

  const handleDateRangeChange = (
    dates: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null,
  ) => {
    if (dates && dates[0] && dates[1]) {
      setFilters({
        ...filters,
        dateFrom: dates[0].format('YYYY-MM-DD'),
        dateTo: dates[1].format('YYYY-MM-DD'),
      })
    } else {
      setFilters({ ...filters, dateFrom: null, dateTo: null })
    }
  }

  const handleDeleteOld = async () => {
    await deleteOldLogs(deleteDays)
    message.success(`Логи старше ${deleteDays} дн. удалены`)
  }

  const columns: ColumnsType<ErrorLog> = [
    {
      title: 'Дата',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (value: string) => dayjs(value).format('DD.MM.YYYY HH:mm:ss'),
    },
    {
      title: 'Тип',
      dataIndex: 'errorType',
      key: 'errorType',
      width: 100,
      render: (value: ErrorLogType) => {
        const config = ERROR_TYPE_CONFIG[value]
        return <Tag color={config?.color}>{config?.label ?? value}</Tag>
      },
    },
    {
      title: 'Сообщение',
      dataIndex: 'errorMessage',
      key: 'errorMessage',
      ellipsis: true,
    },
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      width: 200,
      ellipsis: true,
      render: (value: string | null) => value ? new URL(value).pathname : '—',
    },
    {
      title: 'Пользователь',
      dataIndex: 'userEmail',
      key: 'userEmail',
      width: 180,
      ellipsis: true,
      render: (value: string | undefined) => value ?? '—',
    },
    {
      title: 'Компонент',
      dataIndex: 'component',
      key: 'component',
      width: 150,
      ellipsis: true,
      render: (value: string | null) => value ?? '—',
    },
  ]

  return (
    <div>
      {/* Фильтры */}
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          mode="multiple"
          placeholder="Тип ошибки"
          options={ERROR_TYPE_OPTIONS}
          onChange={handleTypeFilterChange}
          value={filters.errorTypes ?? []}
          style={{ minWidth: 200 }}
          allowClear
        />
        <RangePicker
          onChange={handleDateRangeChange}
          format="DD.MM.YYYY"
          value={
            filters.dateFrom && filters.dateTo
              ? [dayjs(filters.dateFrom), dayjs(filters.dateTo)]
              : null
          }
        />
        <Button icon={<ReloadOutlined />} onClick={fetchLogs}>
          Обновить
        </Button>
        <Space>
          <Text>Удалить старше</Text>
          <InputNumber
            min={1}
            max={365}
            value={deleteDays}
            onChange={(v) => setDeleteDays(v ?? 30)}
            style={{ width: 70 }}
          />
          <Text>дн.</Text>
          <Popconfirm
            title={`Удалить все логи старше ${deleteDays} дней?`}
            onConfirm={handleDeleteOld}
            okText="Удалить"
            cancelText="Отмена"
          >
            <Button icon={<DeleteOutlined />} danger>
              Очистить
            </Button>
          </Popconfirm>
        </Space>
      </Space>

      {/* Таблица */}
      <Table
        columns={columns}
        dataSource={logs}
        rowKey="id"
        loading={isLoading}
        scroll={{ x: 1000 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
          onChange: (p, ps) => {
            setPage(p)
            if (ps !== pageSize) setPageSize(ps)
          },
        }}
        expandable={{
          expandedRowRender: (record) => (
            <div>
              {record.errorStack && (
                <div style={{ marginBottom: 8 }}>
                  <Text strong>Stack trace:</Text>
                  <pre style={{
                    fontSize: 12,
                    maxHeight: 300,
                    overflow: 'auto',
                    background: '#f5f5f5',
                    padding: 8,
                    borderRadius: 4,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}>
                    {record.errorStack}
                  </pre>
                </div>
              )}
              {record.metadata && (
                <div style={{ marginBottom: 8 }}>
                  <Text strong>Metadata:</Text>
                  <pre style={{
                    fontSize: 12,
                    maxHeight: 200,
                    overflow: 'auto',
                    background: '#f5f5f5',
                    padding: 8,
                    borderRadius: 4,
                  }}>
                    {JSON.stringify(record.metadata, null, 2)}
                  </pre>
                </div>
              )}
              {record.userAgent && (
                <div>
                  <Text strong>User Agent:</Text>
                  <Text style={{ fontSize: 12, marginLeft: 8 }}>{record.userAgent}</Text>
                </div>
              )}
            </div>
          ),
          rowExpandable: (record) => !!(record.errorStack || record.metadata || record.userAgent),
        }}
      />
    </div>
  )
}

export default ErrorLogsPage
