import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Spin, Flex } from 'antd'
import MainLayout from '@/layout/MainLayout'
import AuthLayout from '@/layout/AuthLayout'
import ProtectedRoute from '@/components/ProtectedRoute'
import RoleGuard from '@/components/RoleGuard'
import LoginPage from '@/pages/LoginPage'
import CounterpartiesPage from '@/pages/CounterpartiesPage'
import PaymentRequestsPage from '@/pages/PaymentRequestsPage'
import PaymentRequestSettingsPage from '@/pages/PaymentRequestSettingsPage'
import DistributionLettersPage from '@/pages/DistributionLettersPage'
import ApprovalsPage from '@/pages/ApprovalsPage'
import EmployeesPage from '@/pages/EmployeesPage'
import ConstructionSitesPage from '@/pages/ConstructionSitesPage'
import DocumentTypesPage from '@/pages/DocumentTypesPage'
import ApprovalChainsPage from '@/pages/ApprovalChainsPage'
import SiteDocumentsPage from '@/pages/SiteDocumentsPage'
import OcrSettingsPage from '@/pages/OcrSettingsPage'
import UsersPage from '@/pages/UsersPage'
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
        {/* Авторизация */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>

        {/* Основное приложение (защищено авторизацией) */}
        <Route element={<ProtectedRoute />}>
          <Route element={<MainLayout />}>
            {/* Доступно всем авторизованным */}
            <Route path="/" element={<Navigate to="/payment-requests" replace />} />
            <Route path="/payment-requests" element={<PaymentRequestsPage />} />

            {/* Только admin и user (внутренние сотрудники) */}
            <Route element={<RoleGuard allowedRoles={['admin', 'user']} />}>
              <Route path="/counterparties" element={<CounterpartiesPage />} />
              <Route path="/distribution-letters" element={<DistributionLettersPage />} />
              <Route path="/approvals" element={<ApprovalsPage />} />
              <Route path="/employees" element={<EmployeesPage />} />
              <Route path="/sites" element={<ConstructionSitesPage />} />
              <Route path="/document-types" element={<DocumentTypesPage />} />
            </Route>

            {/* Только admin */}
            <Route element={<RoleGuard allowedRoles={['admin']} />}>
              <Route path="/approval-chains" element={<ApprovalChainsPage />} />
              <Route path="/site-documents" element={<SiteDocumentsPage />} />
              <Route path="/settings/ocr" element={<OcrSettingsPage />} />
              <Route path="/settings/payment-requests" element={<PaymentRequestSettingsPage />} />
              <Route path="/users" element={<UsersPage />} />
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
