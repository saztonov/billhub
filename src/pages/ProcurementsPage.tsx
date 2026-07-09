import { useState } from 'react'
import { Typography, Tabs, Table, Segmented, Empty, Alert, Space } from 'antd'
import { UnorderedListOutlined, AppstoreOutlined, PartitionOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useSearchParams } from 'react-router-dom'
import type {
  ProcurementDistributionMode,
  ProcurementMaterialSummaryRow,
  ProcurementOrder,
} from '@/types/procurement'

const { Title } = Typography

const DEFAULT_TAB = 'distribution'

/** Форматирование количества/суммы. */
const fmtNum = (v: number | null | undefined): string => {
  if (v == null) return '—'
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 4 })
}

// Раздел «Закупки» пока не подключён к источнику данных (импорт заявок СУ-10 из EstiMat
// и распределение по поставщикам — в разработке). Ниже — каркас с тремя режимами
// отображения материалов и реестром заказов; данные появятся после подключения интеграции.
const IN_DEVELOPMENT_NOTICE =
  'Раздел в разработке. Заявки на приобретение через СУ-10 импортируются из EstiMat, ' +
  'после чего материалы распределяются по поставщикам в заказы. Источник данных пока не подключён.'

// ───────────────────────── Вкладка «Распределение» ─────────────────────────

const DistributionTab = () => {
  const [mode, setMode] = useState<ProcurementDistributionMode>('to-distribute')

  // Колонки режима «Материалы к распределению» — заявлено / зарезервировано / присуждено / остаток.
  const materialColumns: ColumnsType<ProcurementMaterialSummaryRow> = [
    { title: 'Материал', dataIndex: 'materialName', key: 'materialName', ellipsis: true },
    { title: 'Ед.', dataIndex: 'materialUnit', key: 'materialUnit', width: 90 },
    {
      title: 'Категория работ',
      dataIndex: 'costCategoryName',
      key: 'costCategoryName',
      ellipsis: true,
    },
    { title: 'Вид работ', dataIndex: 'costTypeName', key: 'costTypeName', ellipsis: true },
    {
      title: 'Заявлено',
      dataIndex: 'requestedQuantity',
      key: 'requestedQuantity',
      width: 120,
      align: 'right',
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Зарезервировано',
      dataIndex: 'allocatedQuantity',
      key: 'allocatedQuantity',
      width: 140,
      align: 'right',
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Присуждено',
      dataIndex: 'awardedQuantity',
      key: 'awardedQuantity',
      width: 120,
      align: 'right',
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Остаток',
      dataIndex: 'remainingQuantity',
      key: 'remainingQuantity',
      width: 120,
      align: 'right',
      render: (v: number) => fmtNum(v),
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Segmented<ProcurementDistributionMode>
        value={mode}
        onChange={setMode}
        options={[
          { label: 'По заявкам', value: 'by-request', icon: <UnorderedListOutlined /> },
          {
            label: 'Материалы к распределению',
            value: 'to-distribute',
            icon: <AppstoreOutlined />,
          },
          { label: 'По категориям работ', value: 'by-category', icon: <PartitionOutlined /> },
        ]}
      />

      {mode === 'by-request' && (
        <Empty description="Заявки на приобретение СУ-10 появятся здесь после импорта из EstiMat." />
      )}

      {mode === 'to-distribute' && (
        <Table<ProcurementMaterialSummaryRow>
          dataSource={[]}
          columns={materialColumns}
          rowKey="key"
          size="small"
          pagination={{ pageSize: 50, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="Нет материалов к распределению." /> }}
        />
      )}

      {mode === 'by-category' && (
        <Empty description="Материалы в разрезе «категория работ → вид работ → материалы» появятся после импорта." />
      )}
    </Space>
  )
}

// ───────────────────────── Вкладка «Заказы» ─────────────────────────

const OrdersTab = () => {
  const columns: ColumnsType<ProcurementOrder> = [
    { title: 'Номер', dataIndex: 'number', key: 'number', width: 130 },
    { title: 'Подрядчик', dataIndex: 'contractorName', key: 'contractorName', ellipsis: true },
    { title: 'Объект', dataIndex: 'objectName', key: 'objectName', ellipsis: true },
    { title: 'Статус', dataIndex: 'statusName', key: 'statusName', width: 180 },
    {
      title: 'Сумма',
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      width: 140,
      align: 'right',
      render: (v: number) => fmtNum(v),
    },
    { title: 'Создан', dataIndex: 'createdAt', key: 'createdAt', width: 170 },
  ]

  return (
    <Table<ProcurementOrder>
      dataSource={[]}
      columns={columns}
      rowKey="id"
      size="small"
      pagination={{ pageSize: 50, showSizeChanger: false }}
      locale={{
        emptyText: (
          <Empty description="Заказы поставщикам появятся после распределения материалов." />
        ),
      }}
    />
  )
}

// ───────────────────────── Страница «Закупки» ─────────────────────────

const ProcurementsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? DEFAULT_TAB

  const handleTabChange = (key: string) => {
    setSearchParams({ tab: key }, { replace: true })
  }

  const items = [
    { key: 'distribution', label: 'Распределение', children: <DistributionTab /> },
    { key: 'orders', label: 'Заказы', children: <OrdersTab /> },
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 64px - 1px - 32px)',
        overflow: 'auto',
      }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        items={items}
        renderTabBar={(props, DefaultTabBar) => (
          <div>
            <Title level={2} style={{ marginBottom: 16 }}>
              Закупки
            </Title>
            <Alert
              type="info"
              showIcon
              message={IN_DEVELOPMENT_NOTICE}
              style={{ marginBottom: 16 }}
            />
            <DefaultTabBar {...props} />
          </div>
        )}
      />
    </div>
  )
}

export default ProcurementsPage
