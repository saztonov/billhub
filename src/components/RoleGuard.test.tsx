import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { useAuthStore } from '@/store/authStore'
import RoleGuard from './RoleGuard'
import type { UserRole } from '@/types'

function setUser(role: UserRole) {
  useAuthStore.setState({
    isInitialized: true,
    isAuthenticated: true,
    user: {
      id: '1',
      email: 't@test',
      fullName: 'Тест',
      role,
      counterpartyId: null,
      department: 'omts',
      allSites: true,
      isActive: true,
    },
  })
}

function renderGuard(roles: UserRole[]) {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route element={<RoleGuard allowedRoles={roles} />}>
          <Route path="/admin" element={<div data-testid="admin">ADMIN</div>} />
        </Route>
        <Route path="/" element={<div data-testid="home">HOME</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RoleGuard', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isInitialized: false,
      isLoading: false,
      error: null,
      accessTokenExpiresAt: null,
    })
  })

  it('user=null → редирект на /', () => {
    renderGuard(['admin'])
    expect(screen.getByTestId('home')).toBeInTheDocument()
    expect(screen.queryByTestId('admin')).toBeNull()
  })

  it('роль не в allowedRoles → редирект на /', () => {
    setUser('user')
    renderGuard(['admin'])
    expect(screen.getByTestId('home')).toBeInTheDocument()
  })

  it('роль есть в allowedRoles → рендерит дочерний роут', () => {
    setUser('admin')
    renderGuard(['admin'])
    expect(screen.getByTestId('admin')).toBeInTheDocument()
  })

  it('security имеет доступ к маршруту, разрешённому для security', () => {
    setUser('security')
    renderGuard(['security'])
    expect(screen.getByTestId('admin')).toBeInTheDocument()
  })

  it('counterparty_user не имеет доступа к admin-only маршруту', () => {
    setUser('counterparty_user')
    renderGuard(['admin'])
    expect(screen.getByTestId('home')).toBeInTheDocument()
  })

  it('допускает несколько ролей', () => {
    setUser('user')
    renderGuard(['admin', 'user'])
    expect(screen.getByTestId('admin')).toBeInTheDocument()
  })
})
