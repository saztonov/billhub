import { Form, Input, Button, Typography, App } from 'antd'
import { LockOutlined, MailOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

const { Title } = Typography

const LoginPage = () => {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { login, isLoading, error } = useAuthStore()

  const onFinish = async (values: { email: string; password: string }) => {
    await login(values.email, values.password)
    const { isAuthenticated } = useAuthStore.getState()
    if (isAuthenticated) {
      const returnUrl = searchParams.get('returnUrl') || '/'
      // Защита от Open Redirect — только относительные пути
      const safeUrl = returnUrl.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/'
      navigate(safeUrl)
    } else {
      message.error(error || 'Ошибка авторизации')
    }
  }

  return (
    <div>
      <Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
        Вход в систему
      </Title>
      <Form
        name="login"
        onFinish={onFinish}
        layout="vertical"
        size="large"
        autoComplete="off"
      >
        <Form.Item
          name="email"
          rules={[
            { required: true, message: 'Введите email' },
            { type: 'email', message: 'Некорректный email' },
          ]}
        >
          <Input prefix={<MailOutlined />} placeholder="Email" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="password"
          rules={[{ required: true, message: 'Введите пароль' }]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="Пароль" autoComplete="new-password" />
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
