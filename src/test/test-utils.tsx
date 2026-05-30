/**
 * Утилиты для тестов фронта: рендер React-компонентов с обёрткой провайдеров,
 * чтобы тесты не дублировали ConfigProvider, BrowserRouter и т.д.
 */
import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import type { RenderOptions, RenderResult } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

interface WrapperProps {
  children: ReactNode
  initialEntries?: string[]
}

function Providers({ children, initialEntries }: WrapperProps) {
  return <MemoryRouter initialEntries={initialEntries ?? ['/']}>{children}</MemoryRouter>
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialEntries?: string[]
}

export function renderWithProviders(
  ui: ReactElement,
  options: CustomRenderOptions = {},
): RenderResult {
  const { initialEntries, ...rest } = options
  return render(ui, {
    wrapper: ({ children }) => <Providers initialEntries={initialEntries}>{children}</Providers>,
    ...rest,
  })
}

export * from '@testing-library/react'
