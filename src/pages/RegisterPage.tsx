import { useEffect, useState } from 'react'
import { Button, Result, Spin, Flex } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'

interface ValidateTokenResponse {
  valid: boolean
  counterpartyName?: string
}

/**
 * Регистрация подрядчика по ссылке контрагента (registration_token). В keycloak-режиме:
 * валидируем токен, показываем контрагента и продолжаем через корпоративный вход
 * (/api/auth/login?regToken=…). Идентичность создаётся в Keycloak (self-registration),
 * BillHub на callback заводит неактивный доступ (см. онбординг v4).
 */
const RegisterPage = () => {
  const [searchParams] = useSearchParams()
  const authMode = useAuthStore((s) => s.authMode)
  const token = searchParams.get('token') ?? ''
  const [state, setState] = useState<'loading' | 'valid' | 'invalid'>('loading')
  const [counterpartyName, setCounterpartyName] = useState('')

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
          setState('valid')
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

  return (
    <Result
      status="success"
      title="Регистрация подрядчика"
      subTitle={`Контрагент: ${counterpartyName}. Продолжите через корпоративный вход — после входа заявка уйдёт администратору на активацию.`}
      extra={
        <Button
          type="primary"
          onClick={() => {
            window.location.href = `/api/auth/login?regToken=${encodeURIComponent(token)}`
          }}
        >
          Продолжить регистрацию
        </Button>
      }
    />
  )
}

export default RegisterPage
