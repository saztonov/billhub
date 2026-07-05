import { useEffect, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Spin, Flex, App as AntdApp } from 'antd'
import MainLayout from '@/layout/MainLayout'
import AuthLayout from '@/layout/AuthLayout'
import ProtectedRoute from '@/components/ProtectedRoute'
import RoleGuard from '@/components/RoleGuard'
import LoginPage from '@/pages/LoginPage'
import PendingActivationPage from '@/pages/PendingActivationPage'
import RegisterPage from '@/pages/RegisterPage'
import AppUpdateBanner from '@/components/AppUpdateBanner'
import { useAuthStore } from '@/store/authStore'
import { lazyWithRetry } from '@/utils/lazyWithRetry'

/** Корневой редирект: security уходит на вкладку «Поставщики», остальные — в заявки на оплату */
const RootRedirect = () => {
  const role = useAuthStore((s) => s.user?.role)
  return (
    <Navigate
      to={role === 'security' ? '/references?tab=suppliers' : '/payment-requests'}
      replace
    />
  )
}

// Ленивая загрузка страниц с retry при сетевых сбоях
const PaymentRequestsPage = lazyWithRetry(() => import('@/pages/PaymentRequestsPage'))
const ContractRequestsPage = lazyWithRetry(() => import('@/pages/ContractRequestsPage'))
const EmployeesPage = lazyWithRetry(() => import('@/pages/EmployeesPage'))
const ReferencesPage = lazyWithRetry(() => import('@/pages/ReferencesPage'))
const AdminPage = lazyWithRetry(() => import('@/pages/AdminPage'))
const MaterialsPage = lazyWithRetry(() => import('@/pages/MaterialsPage'))
const MaterialsDetailPage = lazyWithRetry(() => import('@/pages/MaterialsDetailPage'))
const ProfilePage = lazyWithRetry(() => import('@/pages/ProfilePage'))

const App = () => {
  // Фоновая проверка сессии при старте — не блокирует рендер публичных маршрутов.
  // ProtectedRoute сам подождёт завершения через флаг isInitialized.
  const checkAuth = useAuthStore((s) => s.checkAuth)
  const loadAuthConfig = useAuthStore((s) => s.loadAuthConfig)
  useEffect(() => {
    // Режим аутентификации (standalone/keycloak) — влияет на страницу входа/выхода.
    loadAuthConfig()
    checkAuth()
  }, [checkAuth, loadAuthConfig])

  return (
    <AntdApp>
      {/* Глобальный баннер обновления фронта — виден на всех маршрутах */}
      <AppUpdateBanner />
      <Routes>
        {/* Авторизация и регистрация (публичные) */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/pending-activation" element={<PendingActivationPage />} />
        </Route>

        {/* Основное приложение (защищено авторизацией) */}
        <Route element={<ProtectedRoute />}>
          <Route element={<MainLayout />}>
            <Route path="/" element={<RootRedirect />} />
            <Route
              path="/profile"
              element={
                <Suspense
                  fallback={
                    <Flex align="center" justify="center" style={{ padding: 48 }}>
                      <Spin size="large" />
                    </Flex>
                  }
                >
                  <ProfilePage />
                </Suspense>
              }
            />

            {/* Заявки видны всем кроме security */}
            <Route element={<RoleGuard allowedRoles={['admin', 'user', 'counterparty_user']} />}>
              <Route
                path="/payment-requests"
                element={
                  <Suspense
                    fallback={
                      <Flex align="center" justify="center" style={{ padding: 48 }}>
                        <Spin size="large" />
                      </Flex>
                    }
                  >
                    <PaymentRequestsPage />
                  </Suspense>
                }
              />
              <Route
                path="/contract-requests"
                element={
                  <Suspense
                    fallback={
                      <Flex align="center" justify="center" style={{ padding: 48 }}>
                        <Spin size="large" />
                      </Flex>
                    }
                  >
                    <ContractRequestsPage />
                  </Suspense>
                }
              />
            </Route>

            {/* Только admin и user (внутренние сотрудники) */}
            <Route element={<RoleGuard allowedRoles={['admin', 'user']} />}>
              <Route
                path="/employees"
                element={
                  <Suspense
                    fallback={
                      <Flex align="center" justify="center" style={{ padding: 48 }}>
                        <Spin size="large" />
                      </Flex>
                    }
                  >
                    <EmployeesPage />
                  </Suspense>
                }
              />
              <Route
                path="/materials"
                element={
                  <Suspense
                    fallback={
                      <Flex align="center" justify="center" style={{ padding: 48 }}>
                        <Spin size="large" />
                      </Flex>
                    }
                  >
                    <MaterialsPage />
                  </Suspense>
                }
              />
              <Route
                path="/materials/:paymentRequestId"
                element={
                  <Suspense
                    fallback={
                      <Flex align="center" justify="center" style={{ padding: 48 }}>
                        <Spin size="large" />
                      </Flex>
                    }
                  >
                    <MaterialsDetailPage />
                  </Suspense>
                }
              />
            </Route>

            {/* Справочники — admin, user, security */}
            <Route element={<RoleGuard allowedRoles={['admin', 'user', 'security']} />}>
              <Route
                path="/references"
                element={
                  <Suspense
                    fallback={
                      <Flex align="center" justify="center" style={{ padding: 48 }}>
                        <Spin size="large" />
                      </Flex>
                    }
                  >
                    <ReferencesPage />
                  </Suspense>
                }
              />
            </Route>

            {/* Только admin */}
            <Route element={<RoleGuard allowedRoles={['admin']} />}>
              <Route
                path="/admin"
                element={
                  <Suspense
                    fallback={
                      <Flex align="center" justify="center" style={{ padding: 48 }}>
                        <Spin size="large" />
                      </Flex>
                    }
                  >
                    <AdminPage />
                  </Suspense>
                }
              />
            </Route>
          </Route>
        </Route>

        {/* Редирект для неизвестных роутов */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AntdApp>
  )
}

export default App
