import { Typography, Tabs } from 'antd'
import { useSearchParams } from 'react-router-dom'
import SiteDocumentsPage from './SiteDocumentsPage'
import PaymentRequestSettingsPage from './PaymentRequestSettingsPage'
import UsersPage from './UsersPage'

const { Title } = Typography

const DEFAULT_TAB = 'site-documents'

const AdminPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? DEFAULT_TAB

  const handleTabChange = (key: string) => {
    setSearchParams({ tab: key }, { replace: true })
  }

  const items = [
    { key: 'site-documents', label: 'Документы объектов', children: <SiteDocumentsPage /> },
    { key: 'payment-requests', label: 'Настройки заявок', children: <PaymentRequestSettingsPage /> },
    { key: 'users', label: 'Пользователи', children: <UsersPage /> },
  ]

  return (
    <div>
      <Title level={2} style={{ marginBottom: 16 }}>Администрирование</Title>
      <Tabs activeKey={activeTab} onChange={handleTabChange} items={items} />
    </div>
  )
}

export default AdminPage
