import { useState, useMemo } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Typography, Avatar, Flex } from 'antd'
import type { MenuProps } from 'antd'
import {
  FileTextOutlined,
  SendOutlined,
  UserOutlined,
  FolderOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '@/store/authStore'
import type { UserRole } from '@/types'

const { Header, Sider, Content } = Layout
const { Text } = Typography

/** Полное меню (admin видит всё) */
const allMenuItems: MenuProps['items'] = [
  { key: '/payment-requests', icon: <FileTextOutlined />, label: 'Заявки на оплату' },
  { key: '/distribution-letters', icon: <SendOutlined />, label: 'Распред. письма' },
  { key: '/references', icon: <FolderOutlined />, label: 'Справочники' },
  { key: '/admin', icon: <SettingOutlined />, label: 'Администрирование' },
]

/** Меню для роли user (без администрирования) */
const userMenuItems: MenuProps['items'] = [
  { key: '/payment-requests', icon: <FileTextOutlined />, label: 'Заявки на оплату' },
  { key: '/distribution-letters', icon: <SendOutlined />, label: 'Распред. письма' },
  { key: '/references', icon: <FolderOutlined />, label: 'Справочники' },
]

/** Меню для роли counterparty_user (только счета) */
const counterpartyMenuItems: MenuProps['items'] = [
  { key: '/payment-requests', icon: <FileTextOutlined />, label: 'Заявки на оплату' },
]

/** Возвращает меню для указанной роли */
function getMenuItems(role: UserRole): MenuProps['items'] {
  switch (role) {
    case 'admin':
      return allMenuItems
    case 'user':
      return userMenuItems
    case 'counterparty_user':
      return counterpartyMenuItems
  }
}

/** Название роли для отображения */
function getRoleLabel(role: UserRole): string {
  switch (role) {
    case 'admin':
      return 'Администратор'
    case 'user':
      return 'Пользователь'
    case 'counterparty_user':
      return 'Контрагент'
  }
}

const MainLayout = () => {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)

  const menuItems = useMemo(
    () => getMenuItems(user?.role ?? 'counterparty_user'),
    [user?.role],
  )

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    navigate(key)
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        onBreakpoint={(broken) => setCollapsed(broken)}
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'sticky',
          top: 0,
          left: 0,
        }}
      >
        <Flex
          align="center"
          justify="center"
          style={{
            height: 64,
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <Text
            strong
            style={{
              color: '#fff',
              fontSize: collapsed ? 16 : 20,
              letterSpacing: 1,
              transition: 'font-size 0.2s',
            }}
          >
            {collapsed ? 'BH' : 'BillHub'}
          </Text>
        </Flex>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={handleMenuClick}
          style={{ borderRight: 0 }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            padding: '0 24px',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Flex align="center" gap={8}>
            <Avatar icon={<UserOutlined />} />
            <Flex vertical style={{ lineHeight: 1.3 }}>
              <Text>{user?.email ?? ''}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {user ? getRoleLabel(user.role) : ''}
              </Text>
            </Flex>
          </Flex>
        </Header>

        <Content style={{ margin: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

export default MainLayout
