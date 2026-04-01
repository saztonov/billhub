import { Typography, Tabs } from 'antd'
import { useSearchParams } from 'react-router-dom'
import CounterpartiesPage from './CounterpartiesPage'
import SuppliersPage from './SuppliersPage'
import ConstructionSitesPage from './ConstructionSitesPage'
import DocumentTypesPage from './DocumentTypesPage'
import CostTypesPage from './CostTypesPage'
import FoundingDocumentsTab from '@/components/foundingDocuments/FoundingDocumentsTab'
import { useAuthStore } from '@/store/authStore'
import { useOmtsRpStore } from '@/store/omtsRpStore'
import { useEffect } from 'react'

const { Title } = Typography

const DEFAULT_TAB = 'counterparties'

const ReferencesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? DEFAULT_TAB
  const user = useAuthStore((s) => s.user)
  const responsibleUserId = useOmtsRpStore((s) => s.responsibleUserId)
  const fetchOmtsRpConfig = useOmtsRpStore((s) => s.fetchConfig)

  // Загружаем конфигурацию ОМТС РП для проверки доступа к вкладке
  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'user') {
      fetchOmtsRpConfig()
    }
  }, [user?.role, fetchOmtsRpConfig])

  // CRUD для видов затрат доступен только admin и сметному отделу
  const canEditCostTypes = user?.role === 'admin' || user?.department === 'smetny'

  // Вкладка учредительных документов видна admin, ОМТС и ОМТС РП
  const canSeeFoundingDocs =
    user?.role === 'admin' ||
    user?.department === 'omts' ||
    (!!user?.id && user.id === responsibleUserId)

  const handleTabChange = (key: string) => {
    setSearchParams({ tab: key }, { replace: true })
  }

  const items = [
    { key: 'counterparties', label: 'Подрядчики', children: <CounterpartiesPage /> },
    { key: 'suppliers', label: 'Поставщики', children: <SuppliersPage /> },
    { key: 'sites', label: 'Объекты строительства', children: <ConstructionSitesPage /> },
    { key: 'document-types', label: 'Типы документов', children: <DocumentTypesPage /> },
    { key: 'cost-types', label: 'Виды затрат', children: <CostTypesPage canEdit={canEditCostTypes} /> },
    ...(canSeeFoundingDocs
      ? [{ key: 'founding-documents', label: 'Учредительные документы', children: <FoundingDocumentsTab /> }]
      : []),
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
