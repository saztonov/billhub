import { useState, useMemo, useEffect, useCallback } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Typography, Avatar, Flex, Dropdown, Badge, Popover, List, Button } from 'antd'
import type { MenuProps } from 'antd'
import {
  FileTextOutlined,
  SendOutlined,
  UserOutlined,
  FolderOutlined,
  SettingOutlined,
  LogoutOutlined,
  BellOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '@/store/authStore'
import { useNotificationStore } from '@/store/notificationStore'
import type { UserRole, AppNotification } from '@/types'

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
      return 'Подрядчик'
  }
}

const MainLayout = () => {
  const [collapsed, setCollapsed] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const {
    notifications,
    unreadCount,
    fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
  } = useNotificationStore()

  const showNotifications = user?.role !== 'counterparty_user'

  // Polling счётчика непрочитанных уведомлений
  useEffect(() => {
    if (!user?.id || !showNotifications) return
    fetchUnreadCount(user.id)
    const interval = setInterval(() => fetchUnreadCount(user.id), 30000)
    return () => clearInterval(interval)
  }, [user?.id, showNotifications, fetchUnreadCount])

  const handleNotifOpen = useCallback((open: boolean) => {
    setNotifOpen(open)
    if (open && user?.id) {
      fetchNotifications(user.id)
    }
  }, [user?.id, fetchNotifications])

  const handleNotifClick = useCallback((notif: AppNotification) => {
    if (!notif.isRead) {
      markAsRead(notif.id)
    }
    setNotifOpen(false)
    navigate('/payment-requests')
  }, [markAsRead, navigate])

  const handleMarkAllRead = useCallback(() => {
    if (user?.id) {
      markAllAsRead(user.id)
    }
  }, [user?.id, markAllAsRead])

  const menuItems = useMemo(
    () => getMenuItems(user?.role ?? 'counterparty_user'),
    [user?.role],
  )

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    navigate(key)
  }

  const notificationContent = (
    <div style={{ width: 380, maxHeight: 420, overflow: 'auto' }}>
      <Flex justify="space-between" align="center" style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
        <Text strong>Уведомления</Text>
        {unreadCount > 0 && (
          <Button type="link" size="small" onClick={handleMarkAllRead}>
            Прочитать все
          </Button>
        )}
      </Flex>
      <List
        dataSource={notifications}
        renderItem={(item: AppNotification) => (
          <List.Item
            style={{
              background: item.isRead ? 'transparent' : '#f0f5ff',
              padding: '8px 12px',
              cursor: 'pointer',
            }}
            onClick={() => handleNotifClick(item)}
          >
            <Flex vertical gap={2} style={{ width: '100%' }}>
              <Text strong style={{ fontSize: 13 }}>{item.title}</Text>
              <Text style={{ fontSize: 12 }}>{item.message}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {new Date(item.createdAt).toLocaleString('ru-RU')}
              </Text>
            </Flex>
          </List.Item>
        )}
        locale={{ emptyText: 'Нет уведомлений' }}
      />
    </div>
  )

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
            gap: 16,
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          {showNotifications && (
            <Popover
              content={notificationContent}
              trigger="click"
              placement="bottomRight"
              open={notifOpen}
              onOpenChange={handleNotifOpen}
            >
              <Badge count={unreadCount} size="small">
                <BellOutlined style={{ fontSize: 20, cursor: 'pointer' }} />
              </Badge>
            </Popover>
          )}
          <Dropdown
            menu={{
              items: [
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: 'Выход',
                  onClick: async () => {
                    await logout()
                    navigate('/login')
                  },
                },
              ],
            }}
            trigger={['click']}
          >
            <Flex align="center" gap={8} style={{ cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} />
              <Flex vertical style={{ lineHeight: 1.3 }}>
                <Text>{user?.email ?? ''}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {user ? getRoleLabel(user.role) : ''}
                </Text>
              </Flex>
            </Flex>
          </Dropdown>
        </Header>

        <Content style={{ margin: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

export default MainLayout
