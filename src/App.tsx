import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Spin, Flex } from 'antd'
import MainLayout from '@/layout/MainLayout'
import AuthLayout from '@/layout/AuthLayout'
import ProtectedRoute from '@/components/ProtectedRoute'
import RoleGuard from '@/components/RoleGuard'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import PaymentRequestsPage from '@/pages/PaymentRequestsPage'
import DistributionLettersPage from '@/pages/DistributionLettersPage'
import EmployeesPage from '@/pages/EmployeesPage'
import ReferencesPage from '@/pages/ReferencesPage'
import AdminPage from '@/pages/AdminPage'
import { useAuthStore } from '@/store/authStore'

/** Инициализация сессии при загрузке приложения */
const AppInitializer = ({ children }: { children: React.ReactNode }) => {
  const checkAuth = useAuthStore((s) => s.checkAuth)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    checkAuth().finally(() => setIsReady(true))
  }, [checkAuth])

  if (!isReady) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: '100vh' }}>
        <Spin size="large" />
      </Flex>
    )
  }

  return <>{children}</>
}

const App = () => {
  return (
    <AppInitializer>
      <Routes>
        {/* Авторизация и регистрация */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        {/* Основное приложение (защищено авторизацией) */}
        <Route element={<ProtectedRoute />}>
          <Route element={<MainLayout />}>
            {/* Доступно всем авторизованным */}
            <Route path="/" element={<Navigate to="/payment-requests" replace />} />
            <Route path="/payment-requests" element={<PaymentRequestsPage />} />

            {/* Только admin и user (внутренние сотрудники) */}
            <Route element={<RoleGuard allowedRoles={['admin', 'user']} />}>
              <Route path="/distribution-letters" element={<DistributionLettersPage />} />
              <Route path="/employees" element={<EmployeesPage />} />
              <Route path="/references" element={<ReferencesPage />} />
            </Route>

            {/* Только admin */}
            <Route element={<RoleGuard allowedRoles={['admin']} />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
          </Route>
        </Route>

        {/* Редирект для неизвестных роутов */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppInitializer>
  )
}

export default App
