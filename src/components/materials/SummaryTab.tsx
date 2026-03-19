import { useEffect, useMemo, useState, useCallback } from 'react'
import { Table, Select, DatePicker, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMaterialsStore } from '@/store/materialsStore'
import type {
  HierarchyFlatRow,
  HierarchyCounterpartyRow,
  HierarchyMaterialRow,
} from '@/store/materialsStore'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useSupplierStore } from '@/store/supplierStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useCostTypeStore } from '@/store/costTypeStore'
import { useTableScrollY } from '@/hooks/useTableScrollY'
import { buildSummaryHierarchy, isGroupRow, isCounterpartyRow } from '@/utils/buildSummaryHierarchy'
import type { Dayjs } from 'dayjs'

const { RangePicker } = DatePicker

/** Форматирование суммы */
const fmtAmount = (v: number | null | undefined): string => {
  if (v == null) return '—'
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface SummaryFilters {
  counterpartyId?: string
  supplierId?: string
  siteId?: string
  costTypeId?: string
  dateFrom?: string
  dateTo?: string
}

/** Колонки вложенной таблицы материалов */
const materialColumns: ColumnsType<HierarchyMaterialRow> = [
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
    width: 90,
    render: (v: string | null) => v ?? '—',
  },
  {
    title: 'Количество',
    dataIndex: 'totalQuantity',
    key: 'totalQuantity',
    width: 120,
    align: 'right' as const,
    render: (v: number) => fmtAmount(v),
  },
  {
    title: 'Кол-во смета',
    dataIndex: 'totalEstimateQuantity',
    key: 'totalEstimateQuantity',
    width: 130,
    align: 'right' as const,
    render: (v: number) => fmtAmount(v),
  },
  {
    title: 'Отклонение',
    dataIndex: 'deviation',
    key: 'deviation',
    width: 130,
    align: 'right' as const,
    render: (v: number) => {
      if (v === 0) return <Tag>0,00</Tag>
      return (
        <Tag color={v > 0 ? 'red' : 'green'}>
          {v > 0 ? '+' : ''}{fmtAmount(v)}
        </Tag>
      )
    },
  },
  {
    title: 'Откл. сумма',
    dataIndex: 'deviationAmount',
    key: 'deviationAmount',
    width: 140,
    align: 'right' as const,
    render: (v: number) => {
      if (v === 0) return <Tag>0,00</Tag>
      return (
        <Tag color={v > 0 ? 'red' : 'green'}>
          {v > 0 ? '+' : ''}{fmtAmount(v)}
        </Tag>
      )
    },
  },
  {
    title: 'Средняя цена',
    dataIndex: 'averagePrice',
    key: 'averagePrice',
    width: 140,
    align: 'right' as const,
    render: (v: number) => fmtAmount(v),
  },
  {
    title: 'Сумма',
    dataIndex: 'totalAmount',
    key: 'totalAmount',
    width: 140,
    align: 'right' as const,
    render: (v: number) => fmtAmount(v),
  },
]

const SummaryTab = () => {
  const { hierarchicalRaw, isLoadingHierarchical, fetchHierarchicalSummary } = useMaterialsStore()
  const { counterparties, fetchCounterparties } = useCounterpartyStore()
  const { suppliers, fetchSuppliers } = useSupplierStore()
  const { sites, fetchSites } = useConstructionSiteStore()
  const { costTypes, fetchCostTypes } = useCostTypeStore()

  const { containerRef, scrollY } = useTableScrollY([hierarchicalRaw])
  const [filters, setFilters] = useState<SummaryFilters>({})

  // Загрузка справочников для фильтров
  useEffect(() => {
    if (counterparties.length === 0) fetchCounterparties()
    if (suppliers.length === 0) fetchSuppliers()
    if (sites.length === 0) fetchSites()
    if (costTypes.length === 0) fetchCostTypes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Загрузка данных при изменении фильтров
  useEffect(() => {
    fetchHierarchicalSummary(filters)
  }, [filters, fetchHierarchicalSummary])

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

  // Построение иерархии
  const flatData = useMemo(() => buildSummaryHierarchy(hierarchicalRaw), [hierarchicalRaw])

  // Колонки основной таблицы
  const columns = useMemo<ColumnsType<HierarchyFlatRow>>(
    () => [
      {
        title: 'Наименование',
        key: 'name',
        ellipsis: true,
        render: (_: unknown, record: HierarchyFlatRow) => {
          if (isGroupRow(record)) {
            const prefix = record.level === 'site' ? '' : '    '
            return (
              <span style={{ fontWeight: record.level === 'site' ? 700 : 600 }}>
                {prefix}{record.level === 'site' ? 'Объект: ' : 'Вид затрат: '}{record.label}
              </span>
            )
          }
          if (isCounterpartyRow(record)) {
            return <span style={{ paddingLeft: 32 }}>{record.counterpartyName}</span>
          }
          return null
        },
      },
      {
        title: 'Количество',
        key: 'totalQuantity',
        width: 120,
        align: 'right',
        render: (_: unknown, record: HierarchyFlatRow) => {
          if (isGroupRow(record)) return null
          if (isCounterpartyRow(record)) return null
          return null
        },
      },
      {
        title: 'Кол-во смета',
        key: 'totalEstimateQuantity',
        width: 130,
        align: 'right',
        render: () => null,
      },
      {
        title: 'Отклонение',
        key: 'deviation',
        width: 130,
        align: 'right',
        render: (_: unknown, record: HierarchyFlatRow) => {
          const dev = isGroupRow(record) ? record.deviation : isCounterpartyRow(record) ? record.deviation : 0
          if (dev === 0) return null
          return (
            <Tag color={dev > 0 ? 'red' : 'green'}>
              {dev > 0 ? '+' : ''}{fmtAmount(dev)}
            </Tag>
          )
        },
      },
      {
        title: 'Откл. сумма',
        key: 'deviationAmount',
        width: 150,
        align: 'right',
        render: (_: unknown, record: HierarchyFlatRow) => {
          const devAmt = isGroupRow(record) ? record.deviationAmount : isCounterpartyRow(record) ? record.deviationAmount : 0
          if (devAmt === 0) return null
          return (
            <Tag color={devAmt > 0 ? 'red' : 'green'}>
              {devAmt > 0 ? '+' : ''}{fmtAmount(devAmt)}
            </Tag>
          )
        },
      },
      {
        title: 'Сумма',
        key: 'totalAmount',
        width: 160,
        align: 'right',
        render: (_: unknown, record: HierarchyFlatRow) => {
          if (isGroupRow(record)) {
            return <span style={{ fontWeight: 600 }}>{fmtAmount(record.totalAmount)}</span>
          }
          if (isCounterpartyRow(record)) {
            return fmtAmount(record.totalAmount)
          }
          return null
        },
      },
    ],
    [],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', gap: 16 }}>
      {/* Фильтры */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Select
          placeholder="Вид затрат"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ minWidth: 200, flex: 1 }}
          value={filters.costTypeId}
          onChange={(v) => handleFilterChange('costTypeId', v)}
          options={costTypes.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }))}
        />
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
        <Table<HierarchyFlatRow>
          dataSource={flatData}
          columns={columns}
          rowKey="key"
          loading={isLoadingHierarchical}
          pagination={{ pageSize: 100, showSizeChanger: false }}
          scroll={{ y: scrollY }}
          size="small"
          expandable={{
            expandedRowRender: (record) => {
              if (!isCounterpartyRow(record)) return null
              return (
                <Table<HierarchyMaterialRow>
                  dataSource={(record as HierarchyCounterpartyRow).materials}
                  columns={materialColumns}
                  rowKey="key"
                  pagination={false}
                  size="small"
                />
              )
            },
            rowExpandable: (record) => isCounterpartyRow(record),
          }}
          rowClassName={(record) => {
            if (isGroupRow(record)) {
              return record.level === 'costType'
                ? 'hierarchy-row-cost-type'
                : 'hierarchy-row-site'
            }
            return ''
          }}
        />
      </div>
    </div>
  )
}

export default SummaryTab
