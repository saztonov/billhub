import { useEffect, useState } from 'react'
import { Form, Input, Button, Typography, Spin, Alert, message } from 'antd'
import { UserOutlined, MailOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/services/supabase'

const { Title, Text } = Typography

interface CounterpartyInfo {
  id: string
  name: string
}

const RegisterPage = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [counterparty, setCounterparty] = useState<CounterpartyInfo | null>(null)
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

      const { data, error } = await supabase
        .from('counterparties')
        .select('id, name')
        .eq('registration_token', token)
        .single()

      if (error || !data) {
        setIsInvalid(true)
      } else {
        setCounterparty({ id: data.id, name: data.name })
      }
      setIsValidating(false)
    }

    validateToken()
  }, [token])

  const onFinish = async (values: { full_name: string; email: string; password: string }) => {
    if (!counterparty) return
    setIsSubmitting(true)

    try {
      // Регистрация в Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
      })
      if (authError) throw authError
      if (!authData.user) throw new Error('Не удалось создать пользователя')

      // Создание записи в таблице users
      const { error: insertError } = await supabase
        .from('users')
        .insert({
          id: authData.user.id,
          email: values.email,
          full_name: values.full_name,
          role: 'counterparty_user',
          counterparty_id: counterparty.id,
        })
      if (insertError) throw insertError

      message.success('Регистрация прошла успешно')
      navigate('/payment-requests')
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
        {counterparty?.name}
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
            { min: 8, message: 'Минимум 8 символов' },
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
