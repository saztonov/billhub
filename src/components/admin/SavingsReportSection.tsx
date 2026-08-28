import { useCallback, useEffect, useState } from 'react'
import { Card, Col, DatePicker, Empty, Row, Statistic, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import { useTableScrollY } from '@/hooks/useTableScrollY'
import type { SavingsByUser, SavingsMonth, SavingsReport } from '@/types'

const { RangePicker } = DatePicker
const { Text } = Typography

/** Глубина периода по умолчанию: текущий месяц плюс 11 предыдущих */
const DEFAULT_MONTHS_BACK = 11

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

/** Форматирование суммы в рублях с копейками */
const fmtAmount = (v: number | null | undefined): string => {
  if (v == null) return '—'
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** «2026-08» -> «Август 2026» */
const fmtMonth = (month: string): string => {
  const [year, mon] = month.split('-')
  const name = MONTH_NAMES[Number(mon) - 1]
  return name ? `${name} ${year}` : month
}

/** Колонки вложенной таблицы: экономия по сотрудникам ОМТС */
const userColumns: ColumnsType<SavingsByUser> = [
  {
    title: 'Сотрудник',
    dataIndex: 'fullName',
    key: 'fullName',
    render: (v: string | null) => v ?? 'Не определён',
  },
  {
    title: 'Снижений',
    dataIndex: 'count',
    key: 'count',
    width: 120,
    align: 'right' as const,
  },
  {
    title: 'Экономия, ₽',
    dataIndex: 'saved',
    key: 'saved',
    width: 180,
    align: 'right' as const,
    render: (v: number) => fmtAmount(v),
  },
]

const SavingsReportSection = () => {
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(DEFAULT_MONTHS_BACK, 'month'),
    dayjs(),
  ])
  const [report, setReport] = useState<SavingsReport | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const { containerRef, scrollY } = useTableScrollY([report])

  const fetchReport = useCallback(async (from: Dayjs, to: Dayjs) => {
    setIsLoading(true)
    try {
      const data = await api.get<SavingsReport>('/api/reports/savings', {
        from: from.format('YYYY-MM'),
        to: to.format('YYYY-MM'),
      })
      setReport(data)
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Не удалось загрузить отчёт',
        component: 'SavingsReportSection',
      })
      setReport(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchReport(range[0], range[1])
  }, [fetchReport, range])

  const handleRangeChange = (value: (Dayjs | null)[] | null) => {
    const from = value?.[0]
    const to = value?.[1]
    if (from && to) setRange([from, to])
  }

  const columns: ColumnsType<SavingsMonth> = [
    {
      title: 'Месяц',
      dataIndex: 'month',
      key: 'month',
      render: (v: string) => fmtMonth(v),
    },
    {
      title: 'Снижений',
      dataIndex: 'count',
      key: 'count',
      width: 120,
      align: 'right' as const,
    },
    {
      title: 'Экономия, ₽',
      dataIndex: 'saved',
      key: 'saved',
      width: 200,
      align: 'right' as const,
      render: (v: number) => fmtAmount(v),
    },
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <Row gutter={16}>
        <Col xs={24} sm={12} md={8}>
          <Card size="small">
            <Statistic
              title="Сэкономлено за период"
              value={report?.total.saved ?? 0}
              precision={2}
              suffix="₽"
              loading={isLoading}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card size="small">
            <Statistic title="Снижений цены" value={report?.total.count ?? 0} loading={isLoading} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              Период отчёта
            </Text>
            <RangePicker
              picker="month"
              allowClear={false}
              format="MMMM YYYY"
              style={{ width: '100%' }}
              value={range}
              onChange={handleRangeChange}
            />
          </Card>
        </Col>
      </Row>

      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }}>
        <Table<SavingsMonth>
          dataSource={report?.months ?? []}
          columns={columns}
          rowKey="month"
          loading={isLoading}
          pagination={false}
          size="small"
          scroll={{ y: scrollY }}
          locale={{ emptyText: <Empty description="За выбранный период снижений нет" /> }}
          expandable={{
            expandedRowRender: (record) => (
              <Table<SavingsByUser>
                dataSource={record.byUser}
                columns={userColumns}
                rowKey={(row) => row.userId ?? 'unknown'}
                pagination={false}
                size="small"
              />
            ),
            rowExpandable: (record) => record.byUser.length > 0,
          }}
        />
      </div>
    </div>
  )
}

export default SavingsReportSection
