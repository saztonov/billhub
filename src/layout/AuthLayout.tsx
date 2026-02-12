import { Outlet } from 'react-router-dom'
import { Card, Flex, Typography } from 'antd'

const { Title } = Typography

const AuthLayout = () => {
  return (
    <Flex
      vertical
      align="center"
      justify="center"
      style={{ minHeight: '100vh', background: '#f0f2f5' }}
    >
      <Title level={2} style={{ marginBottom: 24, color: '#1677ff', letterSpacing: 1 }}>
        BillHub
      </Title>
      <Card style={{ width: '100%', maxWidth: 400 }}>
        <Outlet />
      </Card>
    </Flex>
  )
}

export default AuthLayout
