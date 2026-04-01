import { useEffect, useState } from 'react'
import { Form, Input, Button, Typography, Spin, Alert, App } from 'antd'
import { UserOutlined, MailOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '@/services/api'

const { Title, Text } = Typography

interface ValidateTokenResponse {
  valid: boolean
  counterpartyName: string
}

const RegisterPage = () => {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [counterpartyName, setCounterpartyName] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(true)
  const [isInvalid, setIsInvalid] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setIsInvalid(true)
        setIsValidating(false)
        return
      }

      try {
        const data = await api.get<ValidateTokenResponse>('/api/auth/validate-token', { token })
        if (data.valid) {
          setCounterpartyName(data.counterpartyName)
        } else {
          setIsInvalid(true)
        }
      } catch {
        setIsInvalid(true)
      } finally {
        setIsValidating(false)
      }
    }

    validateToken()
  }, [token])

  const onFinish = async (values: { full_name: string; email: string; password: string }) => {
    if (!counterpartyName || !token) return
    setIsSubmitting(true)

    try {
      await api.post('/api/auth/register', {
        email: values.email,
        password: values.password,
        fullName: values.full_name,
        token,
      }, { skipAuthRedirect: true })

      message.success('Регистрация прошла успешно. Войдите с указанными данными.')
      navigate('/login')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ошибка регистрации'
      message.error(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isValidating) {
    return (
      <div style={{ textAlign: 'center', padding: 24 }}>
        <Spin size="large" />
      </div>
    )
  }

  if (isInvalid) {
    return (
      <div>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
          Регистрация
        </Title>
        <Alert
          type="error"
          message="Ссылка недействительна"
          description="Ссылка для регистрации неверна или больше не действительна. Обратитесь к администратору."
          showIcon
        />
      </div>
    )
  }

  return (
    <div>
      <Title level={3} style={{ textAlign: 'center', marginBottom: 8 }}>
        Регистрация
      </Title>
      <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 24 }}>
        {counterpartyName}
      </Text>
      <Form
        name="register"
        onFinish={onFinish}
        layout="vertical"
        size="large"
      >
        <Form.Item
          name="full_name"
          rules={[{ required: true, message: 'Введите ФИО' }]}
        >
          <Input prefix={<UserOutlined />} placeholder="ФИО" />
        </Form.Item>
        <Form.Item
          name="email"
          rules={[
            { required: true, message: 'Введите email' },
            { type: 'email', message: 'Некорректный email' },
          ]}
        >
          <Input prefix={<MailOutlined />} placeholder="Email" />
        </Form.Item>
        <Form.Item
          name="password"
          rules={[
            { required: true, message: 'Введите пароль' },
            { min: 6, message: 'Минимум 6 символов' },
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="Пароль" />
        </Form.Item>
        <Form.Item
          name="password_confirm"
          dependencies={['password']}
          rules={[
            { required: true, message: 'Подтвердите пароль' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve()
                }
                return Promise.reject(new Error('Пароли не совпадают'))
              },
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="Подтверждение пароля" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={isSubmitting} block>
            Зарегистрироваться
          </Button>
        </Form.Item>
      </Form>
    </div>
  )
}

export default RegisterPage
