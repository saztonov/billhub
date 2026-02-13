import { Typography, Tabs } from 'antd'
import { useSearchParams } from 'react-router-dom'
import CounterpartiesPage from './CounterpartiesPage'
import ConstructionSitesPage from './ConstructionSitesPage'
import DocumentTypesPage from './DocumentTypesPage'

const { Title } = Typography

const DEFAULT_TAB = 'counterparties'

const ReferencesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? DEFAULT_TAB

  const handleTabChange = (key: string) => {
    setSearchParams({ tab: key }, { replace: true })
  }

  const items = [
    { key: 'counterparties', label: 'Контрагенты', children: <CounterpartiesPage /> },
    { key: 'sites', label: 'Объекты строительства', children: <ConstructionSitesPage /> },
    { key: 'document-types', label: 'Типы документов', children: <DocumentTypesPage /> },
  ]

  return (
    <div>
      <Title level={2} style={{ marginBottom: 16 }}>Справочники</Title>
      <Tabs activeKey={activeTab} onChange={handleTabChange} items={items} />
    </div>
  )
}

export default ReferencesPage
