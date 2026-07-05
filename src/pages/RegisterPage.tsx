import { useEffect, useState } from 'react'
import { Button, Card, Form, Input, Result, Spin, Flex, Typography, message } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'

interface ValidateTokenResponse {
  valid: boolean
  counterpartyName?: string
}

interface RegisterForm {
  fullName: string
  email: string
  password: string
  confirm: string
}

/**
 * Регистрация подрядчика по ссылке контрагента (registration_token) — Вариант B (регистрация на
 * IdP закрыта). Валидируем токен, показываем форму (ФИО, email, пароль) и POST-им на
 * /api/auth/register-counterparty: бэкенд провижинит идентичность в Keycloak через Admin API и
 * заводит неактивный доступ. После — вход через корпоративный вход, активацию делает администратор.
 */
const RegisterPage = () => {
  const [searchParams] = useSearchParams()
  const authMode = useAuthStore((s) => s.authMode)
  const token = searchParams.get('token') ?? ''
  const [state, setState] = useState<'loading' | 'form' | 'invalid' | 'submitted'>('loading')
  const [counterpartyName, setCounterpartyName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) {
      setState('invalid')
      return
    }
    let active = true
    api
      .get<ValidateTokenResponse>('/api/auth/validate-token', { token }, { skipAuthRedirect: true })
      .then((res) => {
        if (!active) return
        if (res.valid) {
          setCounterpartyName(res.counterpartyName ?? '')
          setState('form')
        } else {
          setState('invalid')
        }
      })
      .catch(() => {
        if (active) setState('invalid')
      })
    return () => {
      active = false
    }
  }, [token])

  const onSubmit = async (values: RegisterForm) => {
    setSubmitting(true)
    try {
      await api.post(
        '/api/auth/register-counterparty',
        {
          token,
          email: values.email.trim(),
          fullName: values.fullName.trim(),
          password: values.password,
        },
        { skipAuthRedirect: true },
      )
      setState('submitted')
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось завершить регистрацию')
    } finally {
      setSubmitting(false)
    }
  }

  if (authMode !== 'keycloak') {
    return (
      <Result
        status="info"
        title="Регистрация"
        subTitle="Регистрация по ссылке доступна при корпоративном входе."
      />
    )
  }
  if (state === 'loading') {
    return (
      <Flex align="center" justify="center" style={{ padding: 48 }}>
        <Spin size="large" />
      </Flex>
    )
  }
  if (state === 'invalid') {
    return (
      <Result
        status="error"
        title="Ссылка недействительна"
        subTitle="Проверьте ссылку регистрации или обратитесь к администратору."
      />
    )
  }
  if (state === 'submitted') {
    return (
      <Result
        status="success"
        title="Заявка принята"
        subTitle="Аккаунт создан и ожидает активации администратором. После активации войдите через корпоративный вход."
        extra={
          <Button
            type="primary"
            onClick={() => {
              window.location.href = '/api/auth/login'
            }}
          >
            Перейти ко входу
          </Button>
        }
      />
    )
  }

  return (
    <Flex align="center" justify="center" style={{ padding: 24 }}>
      <Card style={{ width: '100%', maxWidth: 420 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Регистрация подрядчика
        </Typography.Title>
        <Typography.Paragraph type="secondary">Контрагент: {counterpartyName}</Typography.Paragraph>
        <Form layout="vertical" onFinish={onSubmit} disabled={submitting}>
          <Form.Item
            name="fullName"
            label="ФИО"
            rules={[{ required: true, message: 'Укажите ФИО' }]}
          >
            <Input autoComplete="name" />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Укажите email' },
              { type: 'email', message: 'Некорректный email' },
            ]}
          >
            <Input autoComplete="email" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Пароль"
            rules={[
              { required: true, message: 'Укажите пароль' },
              { min: 8, message: 'Минимум 8 символов' },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="Повторите пароль"
            dependencies={['password']}
            rules={[
              { required: true, message: 'Повторите пароль' },
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  !value || getFieldValue('password') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error('Пароли не совпадают')),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            Зарегистрироваться
          </Button>
        </Form>
      </Card>
    </Flex>
  )
}

export default RegisterPage
