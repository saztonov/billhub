import { useState, useMemo } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Typography, Avatar, Flex } from 'antd'
import type { MenuProps } from 'antd'
import {
  DashboardOutlined,
  TeamOutlined,
  FileTextOutlined,
  SendOutlined,
  CheckCircleOutlined,
  UserOutlined,
  BankOutlined,
  FolderOutlined,
  ApartmentOutlined,
  SafetyOutlined,
  SettingOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '@/store/authStore'
import type { UserRole } from '@/types'

const { Header, Sider, Content } = Layout
const { Text } = Typography

/** Полное меню (admin видит всё) */
const allMenuItems: MenuProps['items'] = [
  { key: '/', icon: <DashboardOutlined />, label: 'Дашборд' },
  { key: '/counterparties', icon: <TeamOutlined />, label: 'Контрагенты' },
  { key: '/invoices', icon: <FileTextOutlined />, label: 'Счета' },
  { key: '/distribution-letters', icon: <SendOutlined />, label: 'Распред. письма' },
  { key: '/approvals', icon: <CheckCircleOutlined />, label: 'Согласования' },
  {
    type: 'group',
    label: 'Справочники',
    children: [
      { key: '/employees', icon: <UserOutlined />, label: 'Сотрудники' },
      { key: '/sites', icon: <BankOutlined />, label: 'Объекты' },
      { key: '/document-types', icon: <FolderOutlined />, label: 'Типы документов' },
    ],
  },
  {
    type: 'group',
    label: 'Администрирование',
    children: [
      { key: '/approval-chains', icon: <ApartmentOutlined />, label: 'Цепочки согласований' },
      { key: '/site-documents', icon: <SafetyOutlined />, label: 'Документы объектов' },
      { key: '/settings/ocr', icon: <SettingOutlined />, label: 'Настройки OCR' },
      { key: '/users', icon: <UserSwitchOutlined />, label: 'Пользователи' },
    ],
  },
]

/** Меню для роли user (без администрирования) */
const userMenuItems: MenuProps['items'] = [
  { key: '/', icon: <DashboardOutlined />, label: 'Дашборд' },
  { key: '/counterparties', icon: <TeamOutlined />, label: 'Контрагенты' },
  { key: '/invoices', icon: <FileTextOutlined />, label: 'Счета' },
  { key: '/distribution-letters', icon: <SendOutlined />, label: 'Распред. письма' },
  { key: '/approvals', icon: <CheckCircleOutlined />, label: 'Согласования' },
  {
    type: 'group',
    label: 'Справочники',
    children: [
      { key: '/employees', icon: <UserOutlined />, label: 'Сотрудники' },
      { key: '/sites', icon: <BankOutlined />, label: 'Объекты' },
      { key: '/document-types', icon: <FolderOutlined />, label: 'Типы документов' },
    ],
  },
]

/** Меню для роли counterparty_user (только счета) */
const counterpartyMenuItems: MenuProps['items'] = [
  { key: '/', icon: <DashboardOutlined />, label: 'Дашборд' },
  { key: '/invoices', icon: <FileTextOutlined />, label: 'Счета' },
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
