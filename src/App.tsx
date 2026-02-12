import { Routes, Route, Navigate } from 'react-router-dom'
import MainLayout from '@/layout/MainLayout'
import AuthLayout from '@/layout/AuthLayout'
import DashboardPage from '@/pages/DashboardPage'
import LoginPage from '@/pages/LoginPage'
import CounterpartiesPage from '@/pages/CounterpartiesPage'
import InvoicesPage from '@/pages/InvoicesPage'
import DistributionLettersPage from '@/pages/DistributionLettersPage'
import ApprovalsPage from '@/pages/ApprovalsPage'
import EmployeesPage from '@/pages/EmployeesPage'
import ConstructionSitesPage from '@/pages/ConstructionSitesPage'
import DocumentTypesPage from '@/pages/DocumentTypesPage'
import ApprovalChainsPage from '@/pages/ApprovalChainsPage'
import SiteDocumentsPage from '@/pages/SiteDocumentsPage'
import OcrSettingsPage from '@/pages/OcrSettingsPage'

const App = () => {
  return (
    <Routes>
      {/* Авторизация */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      {/* Основное приложение */}
      <Route element={<MainLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/counterparties" element={<CounterpartiesPage />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/distribution-letters" element={<DistributionLettersPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/sites" element={<ConstructionSitesPage />} />
        <Route path="/document-types" element={<DocumentTypesPage />} />
        <Route path="/approval-chains" element={<ApprovalChainsPage />} />
        <Route path="/site-documents" element={<SiteDocumentsPage />} />
        <Route path="/settings/ocr" element={<OcrSettingsPage />} />
      </Route>

      {/* Редирект для неизвестных роутов */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
