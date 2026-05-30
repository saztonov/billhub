import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import ruRU from 'antd/locale/ru_RU'
import App from '@/App'
import ErrorBoundary from '@/components/ErrorBoundary'
import { setupGlobalErrorHandlers } from '@/services/errorLogger'
import { theme } from '@/theme'
import '@/index.css'

// Установка глобальных обработчиков ошибок до рендера приложения
setupGlobalErrorHandlers()

/**
 * Подавление шумного предупреждения "Multiple GoTrueClient instances" от Supabase в dev.
 * Это не error-логирование (CLAUDE.md правило про logError не применимо), а перехватчик
 * console.warn для конкретного сообщения от стороннего SDK.
 *
 * TODO(iteration-6): после удаления Supabase Auth (standalone auth раздел 13) этот блок снимается.
 */
if (import.meta.env.DEV) {
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    const message = args[0]
    if (
      typeof message === 'string' &&
      message.includes('Multiple GoTrueClient instances detected')
    ) {
      return
    }
    originalWarn.apply(console, args)
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={ruRU} theme={theme}>
      <ErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </ConfigProvider>
  </React.StrictMode>,
)
