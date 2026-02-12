import { useState } from 'react'
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
} from '@ant-design/icons'

const { Header, Sider, Content } = Layout
const { Text } = Typography

/** Элементы бокового меню */
const menuItems: MenuProps['items'] = [
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
    ],
  },
]

const MainLayout = () => {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

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
            <Text>Пользователь</Text>
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
