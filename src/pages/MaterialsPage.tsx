import { useEffect, useMemo, useState, useCallback } from 'react'
import { Typography, Tabs, Table, Select, DatePicker } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useMaterialsStore } from '@/store/materialsStore'
import type { MaterialsRequestRow, SummaryRow } from '@/store/materialsStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useSupplierStore } from '@/store/supplierStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useTableScrollY } from '@/hooks/useTableScrollY'
import { formatDate } from '@/utils/requestFormatters'
import type { Dayjs } from 'dayjs'

const { Title } = Typography
const { RangePicker } = DatePicker

const DEFAULT_TAB = 'invoices'

/** Форматирование суммы */
const fmtAmount = (v: number | null | undefined): string => {
  if (v == null) return '—'
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ───────────────────────── Вкладка «Счета» ─────────────────────────

const InvoicesTab = () => {
  const navigate = useNavigate()
  const { requests, isLoadingRequests, fetchRequests } = useMaterialsStore()
  const { containerRef, scrollY } = useTableScrollY([requests])

  useEffect(() => {
    fetchRequests()
  }, [fetchRequests])

  const columns = useMemo<ColumnsType<MaterialsRequestRow>>(
    () => [
      {
        title: 'Номер заявки',
        dataIndex: 'requestNumber',
        key: 'requestNumber',
        width: 140,
      },
      {
        title: 'Подрядчик',
        dataIndex: 'counterpartyName',
        key: 'counterpartyName',
        ellipsis: true,
      },
      {
        title: 'Поставщик',
        dataIndex: 'supplierName',
        key: 'supplierName',
        ellipsis: true,
      },
      {
        title: 'Объект',
        dataIndex: 'siteName',
        key: 'siteName',
        ellipsis: true,
      },
      {
        title: 'Дата согласования',
        dataIndex: 'approvedAt',
        key: 'approvedAt',
        width: 170,
        render: (v: string | null) => formatDate(v, false),
      },
      {
        title: 'Позиций',
        dataIndex: 'itemsCount',
        key: 'itemsCount',
        width: 100,
        align: 'right',
      },
      {
        title: 'Сумма',
        dataIndex: 'totalAmount',
        key: 'totalAmount',
        width: 140,
        align: 'right',
        render: (v: number) => fmtAmount(v),
      },
    ],
    [],
  )

  return (
    <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }}>
      <Table<MaterialsRequestRow>
        dataSource={requests}
        columns={columns}
        rowKey="paymentRequestId"
        loading={isLoadingRequests}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        scroll={{ y: scrollY }}
        size="small"
        onRow={(record) => ({
          onClick: () => navigate(`/materials/${record.paymentRequestId}`),
          style: { cursor: 'pointer' },
        })}
      />
    </div>
  )
}

// ───────────────────────── Вкладка «Сводная» ─────────────────────────

interface SummaryFilters {
  counterpartyId?: string
  supplierId?: string
  siteId?: string
  dateFrom?: string
  dateTo?: string
}

const SummaryTab = () => {
  const { summary, isLoadingSummary, fetchSummary } = useMaterialsStore()
  const { counterparties, fetchCounterparties } = useCounterpartyStore()
  const { suppliers, fetchSuppliers } = useSupplierStore()
  const { sites, fetchSites } = useConstructionSiteStore()

  const { containerRef, scrollY } = useTableScrollY([summary])
  const [filters, setFilters] = useState<SummaryFilters>({})

  // Загрузка справочников для фильтров
  useEffect(() => {
    if (counterparties.length === 0) fetchCounterparties()
    if (suppliers.length === 0) fetchSuppliers()
    if (sites.length === 0) fetchSites()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Загрузка сводной при изменении фильтров
  useEffect(() => {
    fetchSummary(filters)
  }, [filters, fetchSummary])

  const handleFilterChange = useCallback(
    (field: keyof SummaryFilters, value: string | undefined) => {
      setFilters((prev) => ({ ...prev, [field]: value }))
    },
    [],
  )

  const handleDateRangeChange = useCallback(
    (dates: [Dayjs | null, Dayjs | null] | null) => {
      setFilters((prev) => ({
        ...prev,
        dateFrom: dates?.[0]?.format('YYYY-MM-DD') ?? undefined,
        dateTo: dates?.[1]?.format('YYYY-MM-DD') ?? undefined,
      }))
    },
    [],
  )

  const columns = useMemo<ColumnsType<SummaryRow>>(
    () => [
      {
        title: 'Наименование',
        dataIndex: 'materialName',
        key: 'materialName',
        ellipsis: true,
      },
      {
        title: 'Ед.изм.',
        dataIndex: 'materialUnit',
        key: 'materialUnit',
        width: 100,
        render: (v: string | null) => v ?? '—',
      },
      {
        title: 'Количество',
        dataIndex: 'totalQuantity',
        key: 'totalQuantity',
        width: 120,
        align: 'right',
        render: (v: number) => fmtAmount(v),
      },
      {
        title: 'Средняя цена',
        dataIndex: 'averagePrice',
        key: 'averagePrice',
        width: 140,
        align: 'right',
        render: (v: number) => fmtAmount(v),
      },
      {
        title: 'Сумма',
        dataIndex: 'totalAmount',
        key: 'totalAmount',
        width: 140,
        align: 'right',
        render: (v: number) => fmtAmount(v),
      },
      {
        title: 'Кол-во смета',
        dataIndex: 'totalEstimateQuantity',
        key: 'totalEstimateQuantity',
        width: 130,
        align: 'right',
        render: (v: number) => fmtAmount(v),
      },
    ],
    [],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', gap: 16 }}>
      {/* Фильтры */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Select
          placeholder="Подрядчик"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ minWidth: 200, flex: 1 }}
          value={filters.counterpartyId}
          onChange={(v) => handleFilterChange('counterpartyId', v)}
          options={counterparties.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          placeholder="Поставщик"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ minWidth: 200, flex: 1 }}
          value={filters.supplierId}
          onChange={(v) => handleFilterChange('supplierId', v)}
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
        />
        <Select
          placeholder="Объект"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ minWidth: 200, flex: 1 }}
          value={filters.siteId}
          onChange={(v) => handleFilterChange('siteId', v)}
          options={sites.map((s) => ({ value: s.id, label: s.name }))}
        />
        <RangePicker
          style={{ minWidth: 240 }}
          format="DD.MM.YYYY"
          onChange={handleDateRangeChange}
          placeholder={['Дата от', 'Дата до']}
        />
      </div>

      {/* Таблица */}
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }}>
        <Table<SummaryRow>
          dataSource={summary}
          columns={columns}
          rowKey="materialId"
          loading={isLoadingSummary}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          scroll={{ y: scrollY }}
          size="small"
        />
      </div>
    </div>
  )
}

// ───────────────────────── Страница «Материалы» ─────────────────────────

const MaterialsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? DEFAULT_TAB

  const handleTabChange = (key: string) => {
    setSearchParams({ tab: key }, { replace: true })
  }

  const items = [
    { key: 'invoices', label: 'Счета', children: <InvoicesTab /> },
    { key: 'summary', label: 'Сводная', children: <SummaryTab /> },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px - 1px - 32px)', overflow: 'hidden' }}>
      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        items={items}
        className="flex-tabs"
        renderTabBar={(props, DefaultTabBar) => (
          <div>
            <Title level={2} style={{ marginBottom: 16 }}>Материалы</Title>
            <DefaultTabBar {...props} />
          </div>
        )}
      />
    </div>
  )
}

export default MaterialsPage
