import React from 'react'
import { Button, Result } from 'antd'
import { logError } from '@/services/errorLogger'
import { isChunkLoadError, handleChunkLoadError } from '@/utils/chunkLoadRecovery'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
}

// Class-компонент — требование React API для перехвата ошибок рендера
class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Ошибка загрузки чанка — одноразовый автоматический reload с логированием внутри
    if (isChunkLoadError(error)) {
      handleChunkLoadError(error, errorInfo.componentStack ?? null)
      return
    }

    logError({
      errorType: 'react_error',
      errorMessage: error.message,
      errorStack: error.stack ?? null,
      component: errorInfo.componentStack ?? null,
    })
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
          <Result
            status="error"
            title="Произошла непредвиденная ошибка"
            subTitle="Информация об ошибке сохранена. Попробуйте перезагрузить страницу."
            extra={
              <Button type="primary" onClick={this.handleReload}>
                Перезагрузить страницу
              </Button>
            }
          />
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
