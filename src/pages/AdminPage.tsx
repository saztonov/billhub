import { Typography, Tabs } from 'antd'
import { useSearchParams } from 'react-router-dom'
import PaymentRequestSettingsPage from './PaymentRequestSettingsPage'
import UsersPage from './UsersPage'
import ErrorLogsPage from './ErrorLogsPage'

const { Title } = Typography

const DEFAULT_TAB = 'users'

const AdminPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? DEFAULT_TAB

  const handleTabChange = (key: string) => {
    setSearchParams({ tab: key }, { replace: true })
  }

  const items = [
    { key: 'payment-requests', label: 'Настройки заявок', children: <PaymentRequestSettingsPage /> },
    { key: 'users', label: 'Пользователи', children: <UsersPage /> },
    { key: 'error-logs', label: 'Логи ошибок', children: <ErrorLogsPage /> },
  ]

  return (
    <div>
      <Title level={2} style={{ marginBottom: 16 }}>Администрирование</Title>
      <Tabs activeKey={activeTab} onChange={handleTabChange} items={items} />
    </div>
  )
}

export default AdminPage
