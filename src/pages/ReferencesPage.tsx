import { Typography, Tabs } from 'antd'
import { useSearchParams } from 'react-router-dom'
import CounterpartiesPage from './CounterpartiesPage'
import SuppliersPage from './SuppliersPage'
import ConstructionSitesPage from './ConstructionSitesPage'
import DocumentTypesPage from './DocumentTypesPage'
import CostTypesPage from './CostTypesPage'
import { useAuthStore } from '@/store/authStore'

const { Title } = Typography

const DEFAULT_TAB = 'counterparties'

const ReferencesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? DEFAULT_TAB
  const user = useAuthStore((s) => s.user)

  // CRUD для видов затрат доступен только admin и сметному отделу
  const canEditCostTypes = user?.role === 'admin' || user?.department === 'smetny'

  const handleTabChange = (key: string) => {
    setSearchParams({ tab: key }, { replace: true })
  }

  const items = [
    { key: 'counterparties', label: 'Подрядчики', children: <CounterpartiesPage /> },
    { key: 'suppliers', label: 'Поставщики', children: <SuppliersPage /> },
    { key: 'sites', label: 'Объекты строительства', children: <ConstructionSitesPage /> },
    { key: 'document-types', label: 'Типы документов', children: <DocumentTypesPage /> },
    { key: 'cost-types', label: 'Виды затрат', children: <CostTypesPage canEdit={canEditCostTypes} /> },
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
            <Title level={2} style={{ marginBottom: 16 }}>Справочники</Title>
            <DefaultTabBar {...props} />
          </div>
        )}
      />
    </div>
  )
}

export default ReferencesPage
