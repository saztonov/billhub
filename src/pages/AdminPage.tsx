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
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px - 1px - 48px)', overflow: 'hidden' }}>
      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        items={items}
        className="flex-tabs"
        renderTabBar={(props, DefaultTabBar) => (
          <div>
            <Title level={2} style={{ marginBottom: 16 }}>Администрирование</Title>
            <DefaultTabBar {...props} />
          </div>
        )}
      />
    </div>
  )
}

export default AdminPage
