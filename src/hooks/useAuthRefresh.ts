import { useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'
import { refreshAccessToken } from '@/services/api'

/** Интервал проверки необходимости обновления — 30 секунд */
const CHECK_INTERVAL_MS = 30_000

/** Порог: обновляем, если до истечения осталось меньше 2 минут */
const REFRESH_THRESHOLD_MS = 2 * 60 * 1000

/**
 * Проактивный refresh access_token.
 *
 * Каждые 30 секунд проверяет, сколько осталось до истечения текущего токена,
 * и если меньше 2 минут — заранее вызывает /api/auth/refresh.
 * Это устраняет штатные 401 в консоли, которые возникали у polling-запросов
 * (например, счётчика уведомлений), наталкивавшихся на истёкшую куку.
 *
 * Дополнительно при возврате вкладки из фонового состояния (visibilitychange)
 * делаем внеплановую проверку — браузеры душат setInterval в фоновых вкладках.
 */
export function useAuthRefresh(): void {
  const userId = useAuthStore((s) => s.user?.id)

  useEffect(() => {
    if (!userId) return

    /** Проверка и запуск refresh при необходимости */
    const checkAndRefresh = (): void => {
      const expiresAt = useAuthStore.getState().accessTokenExpiresAt
      if (!expiresAt) return

      const msLeft = expiresAt - Date.now()
      if (msLeft <= REFRESH_THRESHOLD_MS) {
        /** refreshAccessToken — single-flight, параллельные вызовы безопасны */
        void refreshAccessToken()
      }
    }

    /** Сразу проверяем при монтировании (например, после возврата на вкладку) */
    checkAndRefresh()

    const interval = window.setInterval(checkAndRefresh, CHECK_INTERVAL_MS)

    /** Внеплановая проверка при возврате фокуса на вкладку */
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        checkAndRefresh()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [userId])
}
