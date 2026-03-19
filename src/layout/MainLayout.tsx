import { useState, useMemo, useEffect, useCallback } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Typography, Avatar, Flex, Dropdown, Badge, Popover, List, Button, Drawer } from 'antd'
import type { MenuProps } from 'antd'
import {
  FileTextOutlined,
  UserOutlined,
  FolderOutlined,
  SettingOutlined,
  LogoutOutlined,
  BellOutlined,
  MenuOutlined,
  AppstoreOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '@/store/authStore'
import { useNotificationStore } from '@/store/notificationStore'
import { useHeaderStore } from '@/store/headerStore'
import useIsMobile from '@/hooks/useIsMobile'
import MobileDrawerMenu from '@/components/layout/MobileDrawerMenu'
import OcrQueueWidget from '@/components/admin/OcrQueueWidget'
import type { UserRole, AppNotification } from '@/types'

const { Header, Sider, Content } = Layout
const { Text } = Typography

/** Меню для роли counterparty_user (только заявки) */
const counterpartyMenuItems: MenuProps['items'] = [
  { key: '/payment-requests', icon: <FileTextOutlined />, label: 'Заявки на оплату' },
]

/** Возвращает меню для указанной роли и отдела */
function getMenuItems(role: UserRole, department?: string | null): MenuProps['items'] {
  if (role === 'counterparty_user') return counterpartyMenuItems

  const items: MenuProps['items'] = [
    { key: '/payment-requests', icon: <FileTextOutlined />, label: 'Заявки на оплату' },
  ]

  // Материалы видны admin и сметному отделу
  if (role === 'admin' || department === 'smetny') {
    items.push({ key: '/materials', icon: <AppstoreOutlined />, label: 'Материалы' })
  }

  items.push({ key: '/references', icon: <FolderOutlined />, label: 'Справочники' })

  if (role === 'admin') {
    items.push({ key: '/admin', icon: <SettingOutlined />, label: 'Администрирование' })
  }

  return items
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [mobileNotifOpen, setMobileNotifOpen] = useState(false)
  const isMobile = useIsMobile()
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

  // Polling счётчика непрочитанных уведомлений
  useEffect(() => {
    if (!user?.id) return
    fetchUnreadCount(user.id)
    const interval = setInterval(() => fetchUnreadCount(user.id), 30000)
    return () => clearInterval(interval)
  }, [user?.id, fetchUnreadCount])

  const handleNotifOpen = useCallback((open: boolean) => {
    setNotifOpen(open)
    if (open && user?.id) {
      fetchNotifications(user.id)
    }
  }, [user?.id, fetchNotifications])

  const handleMobileNotifOpen = useCallback((open: boolean) => {
    setMobileNotifOpen(open)
    if (open && user?.id) {
      fetchNotifications(user.id)
    }
  }, [user?.id, fetchNotifications])

  const handleNotifClick = useCallback((notif: AppNotification) => {
    if (!notif.isRead) {
      markAsRead(notif.id)
    }
    setNotifOpen(false)
    setMobileNotifOpen(false)
    navigate('/payment-requests', {
      state: notif.paymentRequestId ? { openRequestId: notif.paymentRequestId } : undefined,
    })
  }, [markAsRead, navigate])

  const handleMarkAllRead = useCallback(() => {
    if (user?.id) {
      markAllAsRead(user.id)
    }
  }, [user?.id, markAllAsRead])

  const headerTitle = useHeaderStore((s) => s.title)
  const headerExtra = useHeaderStore((s) => s.extra)
  const headerActions = useHeaderStore((s) => s.actions)

  const menuItems = useMemo(
    () => getMenuItems(user?.role ?? 'counterparty_user', user?.department),
    [user?.role, user?.department],
  )

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    navigate(key)
  }

  const handleLogout = useCallback(async () => {
    await logout()
    navigate('/login')
  }, [logout, navigate])

  // Контент уведомлений (переиспользуется в Popover и Drawer)
  const notificationList = (
    <>
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
    </>
  )

  // --- Мобильная версия ---
  if (isMobile) {
    return (
      <Layout style={{ minHeight: '100vh' }}>
        <Header
          style={{
            padding: '0 12px',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            lineHeight: 'normal',
            borderBottom: '1px solid #f0f0f0',
            position: 'sticky',
            top: 0,
            zIndex: 10,
            height: 48,
          }}
        >
          <Flex align="center" gap={8}>
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setMobileMenuOpen(true)}
              style={{ fontSize: 18 }}
            />
            {headerTitle && (
              <Typography.Title level={5} style={{ margin: 0, whiteSpace: 'nowrap', fontSize: 15 }}>
                {headerTitle}
              </Typography.Title>
            )}
          </Flex>

          <Badge count={unreadCount} size="small">
            <BellOutlined
              style={{ fontSize: 20, cursor: 'pointer' }}
              onClick={() => handleMobileNotifOpen(true)}
            />
          </Badge>
        </Header>

        <Content id="main-content" style={{ padding: 8, overflow: 'auto', flex: 1 }}>
          <Outlet />
        </Content>

        <MobileDrawerMenu
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          menuItems={menuItems}
          selectedKeys={[location.pathname]}
          onMenuClick={handleMenuClick}
          userEmail={user?.email}
          userRole={user?.role}
          onLogout={handleLogout}
        />

        {/* Уведомления в Drawer на мобильном */}
        <Drawer
          title="Уведомления"
          placement="right"
          open={mobileNotifOpen}
          onClose={() => setMobileNotifOpen(false)}
          width="100%"
          styles={{ body: { padding: 0 } }}
        >
          {notificationList}
        </Drawer>
      </Layout>
    )
  }

  // --- Десктопная версия (без изменений) ---
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

      <Layout style={{ height: '100vh' }}>
        <Header
          style={{
            padding: '0 24px',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            lineHeight: 'normal',
            borderBottom: '1px solid #f0f0f0',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <Flex align="center" gap={12} style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
            {headerTitle && (
              <Typography.Title level={5} style={{ margin: 0, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {headerTitle}
              </Typography.Title>
            )}
            {headerExtra}
          </Flex>
          <Flex align="center" gap={12} style={{ flexShrink: 0 }}>
            {headerActions}
            {user?.role === 'admin' && <OcrQueueWidget />}
            <Popover
              content={
                <div style={{ width: 380, maxHeight: 420, overflow: 'auto' }}>
                  {notificationList}
                </div>
              }
              trigger="click"
              placement="bottomRight"
              open={notifOpen}
              onOpenChange={handleNotifOpen}
            >
              <Badge count={unreadCount} size="small">
                <BellOutlined style={{ fontSize: 20, cursor: 'pointer' }} />
              </Badge>
            </Popover>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'profile',
                  icon: <UserOutlined />,
                  label: 'Личный кабинет',
                  onClick: () => navigate('/profile'),
                },
                { type: 'divider' },
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: 'Выход',
                  onClick: handleLogout,
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
          </Flex>
        </Header>

        <Content id="main-content" style={{ padding: 16, overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

export default MainLayout
