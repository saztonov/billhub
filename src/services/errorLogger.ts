import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import type { ErrorLogType } from '@/types'

interface LogErrorParams {
  errorType: ErrorLogType
  errorMessage: string
  errorStack?: string | null
  component?: string | null
  metadata?: Record<string, unknown> | null
}

// Rate limiting: максимум 10 записей в минуту
const RATE_LIMIT = 10
const RATE_WINDOW_MS = 60_000
let callTimestamps: number[] = []

const isRateLimited = (): boolean => {
  const now = Date.now()
  callTimestamps = callTimestamps.filter(ts => now - ts < RATE_WINDOW_MS)
  if (callTimestamps.length >= RATE_LIMIT) return true
  callTimestamps.push(now)
  return false
}

/**
 * Логирование ошибки в таблицу error_logs.
 * Fire-and-forget: не блокирует UI, не бросает ошибку при неудаче.
 */
export const logError = (params: LogErrorParams): void => {
  if (isRateLimited()) return

  const userId = useAuthStore.getState().user?.id ?? null

  Promise.resolve(
    supabase
      .from('error_logs')
      .insert({
        error_type: params.errorType,
        error_message: params.errorMessage.slice(0, 5000),
        error_stack: params.errorStack?.slice(0, 10000) ?? null,
        url: window.location.href,
        user_id: userId,
        user_agent: navigator.userAgent,
        component: params.component ?? null,
        metadata: params.metadata ?? null,
      })
  ).catch(() => {
    // Ошибка логирования не должна влиять на приложение
  })
}

/**
 * Установка глобальных обработчиков ошибок.
 * Вызывать один раз при инициализации приложения.
 */
export const setupGlobalErrorHandlers = (): void => {
  // Перехват JS-ошибок
  window.onerror = (
    message: string | Event,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error,
  ) => {
    logError({
      errorType: 'js_error',
      errorMessage: typeof message === 'string' ? message : 'Unknown error',
      errorStack: error?.stack ?? null,
      metadata: source ? { source, lineno, colno } : null,
    })
    return false // Ошибка продолжает попадать в консоль
  }

  // Перехват необработанных Promise rejection
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const error = event.reason
    logError({
      errorType: 'unhandled_rejection',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack ?? null : null,
    })
  })
}
