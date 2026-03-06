import { Typography, Tabs } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { StickyOffsetContext, useStickyHeaderRef } from '@/hooks/useStickyOffset'
import CounterpartiesPage from './CounterpartiesPage'
import SuppliersPage from './SuppliersPage'
import ConstructionSitesPage from './ConstructionSitesPage'
import DocumentTypesPage from './DocumentTypesPage'

const { Title } = Typography

const DEFAULT_TAB = 'counterparties'

const ReferencesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? DEFAULT_TAB
  const { stickyRef, stickyOffset } = useStickyHeaderRef()

  const handleTabChange = (key: string) => {
    setSearchParams({ tab: key }, { replace: true })
  }

  const items = [
    { key: 'counterparties', label: 'Подрядчики', children: <CounterpartiesPage /> },
    { key: 'suppliers', label: 'Поставщики', children: <SuppliersPage /> },
    { key: 'sites', label: 'Объекты строительства', children: <ConstructionSitesPage /> },
    { key: 'document-types', label: 'Типы документов', children: <DocumentTypesPage /> },
  ]

  return (
    <div>
      <StickyOffsetContext.Provider value={stickyOffset}>
        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          items={items}
          renderTabBar={(props, DefaultTabBar) => (
            <div ref={stickyRef} className="sticky-page-header">
              <Title level={2} style={{ marginBottom: 16 }}>Справочники</Title>
              <DefaultTabBar {...props} />
            </div>
          )}
        />
      </StickyOffsetContext.Provider>
    </div>
  )
}

export default ReferencesPage
