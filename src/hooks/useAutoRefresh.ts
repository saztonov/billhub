import { useCallback, useEffect, useRef } from 'react'

/** Параметры умного авто-обновления списка без перезагрузки страницы. */
interface UseAutoRefreshParams {
  /** Функция обновления данных (обычно silent-загрузчик или bumpRefresh). */
  refresh: () => void | Promise<void>
  /** Механизм активен (роль/страница). При false — ни опроса, ни focus-refetch. */
  enabled?: boolean
  /** Нужен ли сейчас интервальный опрос (в списке есть строка в переходном статусе). */
  polling?: boolean
  /** Период опроса, мс. */
  intervalMs?: number
  /** Кап числа тиков опроса — защита от бесконечного polling при «застрявшей» задаче. */
  maxTicks?: number
  /** Обновлять при возврате фокуса/видимости вкладки. */
  refetchOnFocus?: boolean
  /** Мин. интервал между обновлениями (антидубль focus+visibilitychange и refetch сразу после действий), мс. */
  minRefetchGapMs?: number
  /** Колбэк при достижении капа опроса (для логирования). */
  onPollingCapReached?: () => void
}

/**
 * Умное авто-обновление данных без перезагрузки страницы:
 *  - self-terminating polling: пока polling === true и вкладка видима, дёргает refresh
 *    каждые intervalMs; как только переходных строк не осталось (polling → false) — опрос
 *    прекращается сам;
 *  - refetch при возврате фокуса/видимости вкладки.
 * Защита: не поллит в скрытой вкладке, не запускает refresh поверх незавершённого,
 * объединяет focus+visibilitychange через minRefetchGapMs, держит актуальный refresh в ref
 * (интервал не пересоздаётся на каждый рендер), сам чистит таймеры/слушатели.
 */
export function useAutoRefresh({
  refresh,
  enabled = true,
  polling = false,
  intervalMs = 5000,
  maxTicks = 120,
  refetchOnFocus = false,
  minRefetchGapMs = 5000,
  onPollingCapReached,
}: UseAutoRefreshParams): void {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const capCbRef = useRef(onPollingCapReached)
  capCbRef.current = onPollingCapReached

  // Флаг «идёт запрос» — не допускаем наложения. Время последнего запуска — для min-gap.
  const inFlightRef = useRef(false)
  const lastRunRef = useRef(0)

  const run = useCallback(async (minGapMs?: number) => {
    if (inFlightRef.current) return
    if (document.visibilityState !== 'visible') return
    if (minGapMs && Date.now() - lastRunRef.current < minGapMs) return
    inFlightRef.current = true
    lastRunRef.current = Date.now()
    try {
      await refreshRef.current()
    } finally {
      inFlightRef.current = false
    }
  }, [])

  // Интервальный опрос переходных статусов (само-останов по polling / капу).
  useEffect(() => {
    if (!enabled || !polling) return
    let ticks = 0
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      ticks += 1
      if (ticks > maxTicks) {
        window.clearInterval(id)
        capCbRef.current?.()
        return
      }
      void run()
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [enabled, polling, intervalMs, maxTicks, run])

  // Обновление при возврате фокуса/видимости вкладки.
  useEffect(() => {
    if (!enabled || !refetchOnFocus) return
    const onFocus = () => {
      if (document.visibilityState === 'visible') void run(minRefetchGapMs)
    }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled, refetchOnFocus, minRefetchGapMs, run])
}
