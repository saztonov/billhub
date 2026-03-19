import { useEffect, useMemo } from 'react'
import { Typography, Tabs, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useMaterialsStore } from '@/store/materialsStore'
import type { MaterialsRequestRow } from '@/store/materialsStore'
import { useTableScrollY } from '@/hooks/useTableScrollY'
import { formatDate } from '@/utils/requestFormatters'
import SummaryTab from '@/components/materials/SummaryTab'

const { Title } = Typography

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
        title: 'Счетов',
        dataIndex: 'invoicesCount',
        key: 'invoicesCount',
        width: 90,
        align: 'right',
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
      {
        title: 'Статус',
        dataIndex: 'materialsVerification',
        key: 'materialsVerification',
        width: 130,
        align: 'center',
        render: (v: MaterialsRequestRow['materialsVerification']) => {
          if (!v) return '—'
          if (v.status === 'verified') return <Tag color="green">Проверен</Tag>
          return <Tag color="orange">На проверке</Tag>
        },
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
