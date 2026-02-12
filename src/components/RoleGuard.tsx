import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import type { UserRole } from '@/types'

interface RoleGuardProps {
  allowedRoles: UserRole[]
}

/** Защита маршрутов по ролям. Редирект на главную при отсутствии доступа. */
const RoleGuard = ({ allowedRoles }: RoleGuardProps) => {
  const user = useAuthStore((s) => s.user)

  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

export default RoleGuard
