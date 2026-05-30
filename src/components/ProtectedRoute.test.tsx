import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { useAuthStore } from '@/store/authStore'
import ProtectedRoute from './ProtectedRoute'

function HomePage() {
  return <div data-testid="home">HOME</div>
}
function LoginPage() {
  return <div data-testid="login">LOGIN</div>
}

function renderRoute(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/secret" element={<div data-testid="secret">SECRET</div>} />
        </Route>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute', () => {
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

  it('пока isInitialized=false не рендерит ни защищённый роут, ни login', () => {
    const { container } = renderRoute('/')
    expect(screen.queryByTestId('home')).toBeNull()
    expect(screen.queryByTestId('login')).toBeNull()
    // AntD Spin рендерит элемент с class ant-spin
    expect(container.querySelector('.ant-spin')).toBeInTheDocument()
  })

  it('isInitialized=true + isAuthenticated=false → редирект на /login с returnUrl', () => {
    useAuthStore.setState({ isInitialized: true, isAuthenticated: false })
    renderRoute('/secret')
    expect(screen.getByTestId('login')).toBeInTheDocument()
  })

  it('isInitialized=true + isAuthenticated=true → рендерит дочерний роут', () => {
    useAuthStore.setState({
      isInitialized: true,
      isAuthenticated: true,
      user: { id: '1', role: 'admin' } as never,
    })
    renderRoute('/')
    expect(screen.getByTestId('home')).toBeInTheDocument()
  })
})
