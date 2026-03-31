import { Drawer, Menu, Typography, Flex, Button, Divider } from 'antd'
import type { MenuProps } from 'antd'
import { LogoutOutlined } from '@ant-design/icons'
import type { UserRole } from '@/types'

const { Text } = Typography

interface MobileDrawerMenuProps {
  open: boolean
  onClose: () => void
  menuItems: MenuProps['items']
  selectedKeys: string[]
  onMenuClick: MenuProps['onClick']
  userEmail?: string
  userRole?: UserRole
  onLogout: () => void
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

const MobileDrawerMenu = (props: MobileDrawerMenuProps) => {
  const { open, onClose, menuItems, selectedKeys, onMenuClick, userEmail, userRole, onLogout } = props

  const handleMenuClick: MenuProps['onClick'] = (info) => {
    onMenuClick?.(info)
    onClose()
  }

  return (
    <Drawer
      placement="left"
      open={open}
      onClose={onClose}
      styles={{ wrapper: { width: 280 }, body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
      title={
        <Text strong style={{ fontSize: 20, letterSpacing: 1 }}>
          BillHub
        </Text>
      }
    >
      <Menu
        mode="inline"
        selectedKeys={selectedKeys}
        items={menuItems}
        onClick={handleMenuClick}
        style={{ borderRight: 0, flex: 1 }}
      />

      <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0f0' }}>
        {userEmail && (
          <Flex vertical gap={2} style={{ marginBottom: 12 }}>
            <Text ellipsis style={{ fontSize: 13 }}>{userEmail}</Text>
            {userRole && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {getRoleLabel(userRole)}
              </Text>
            )}
          </Flex>
        )}
        <Divider style={{ margin: '0 0 12px 0' }} />
        <Button
          icon={<LogoutOutlined />}
          onClick={onLogout}
          block
          danger
        >
          Выход
        </Button>
      </div>
    </Drawer>
  )
}

export default MobileDrawerMenu
