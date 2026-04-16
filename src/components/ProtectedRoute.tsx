import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spin, Flex } from 'antd'
import { useAuthStore } from '@/store/authStore'

/** Защита маршрутов от неавторизованных пользователей. Редирект на /login с сохранением returnUrl. */
const ProtectedRoute = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const location = useLocation()

  // Ждём завершения первичной проверки сессии, чтобы не сбрасывать
  // уже авторизованного пользователя на /login во время фонового checkAuth.
  if (!isInitialized) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: '100vh' }}>
        <Spin size="large" />
      </Flex>
    )
  }

  if (!isAuthenticated) {
    const returnUrl = location.pathname + location.search
    return <Navigate to={`/login?returnUrl=${encodeURIComponent(returnUrl)}`} replace />
  }

  return <Outlet />
}

export default ProtectedRoute
