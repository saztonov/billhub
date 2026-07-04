import { useEffect } from 'react'
import { Form, Input, Button, Typography, Flex, Spin, App } from 'antd'
import { LockOutlined, MailOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

const { Title } = Typography

/** Безопасный returnUrl — только относительные пути. */
function safeReturnUrl(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw
  return '/'
}

const LoginPage = () => {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { login, isLoading, error, authMode } = useAuthStore()

  const returnUrl = safeReturnUrl(searchParams.get('returnUrl'))

  // keycloak-режим: форма логина живёт на Keycloak (auth.su10.ru). Делаем полноэкранный
  // top-level переход на бэкенд, который редиректит на Keycloak (PKCE).
  useEffect(() => {
    if (authMode === 'keycloak') {
      window.location.href = `/api/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`
    }
  }, [authMode, returnUrl])

  if (authMode === 'keycloak') {
    return (
      <Flex align="center" justify="center" vertical style={{ padding: 48, gap: 16 }}>
        <Spin size="large" />
        <Typography.Text type="secondary">Перенаправление на страницу входа…</Typography.Text>
      </Flex>
    )
  }

  const onFinish = async (values: { email: string; password: string }) => {
    await login(values.email, values.password)
    const { isAuthenticated } = useAuthStore.getState()
    if (isAuthenticated) {
      navigate(returnUrl)
    } else {
      message.error(error || 'Ошибка авторизации')
    }
  }

  return (
    <div>
      <Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
        Вход в систему
      </Title>
      <Form name="login" onFinish={onFinish} layout="vertical" size="large" autoComplete="off">
        <Form.Item
          name="email"
          rules={[
            { required: true, message: 'Введите email' },
            { type: 'email', message: 'Некорректный email' },
          ]}
        >
          <Input prefix={<MailOutlined />} placeholder="Email" autoComplete="off" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, message: 'Введите пароль' }]}>
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="Пароль"
            autoComplete="new-password"
          />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={isLoading} block>
            Войти
          </Button>
        </Form.Item>
      </Form>
    </div>
  )
}

export default LoginPage
