import { logError } from '@/services/errorLogger'

// Ключ в sessionStorage: защита от бесконечного цикла reload
const RELOAD_FLAG_KEY = 'billhub_chunk_reload_done'

/**
 * Проверяет, является ли ошибка ошибкой загрузки JS-чанка (сетевой сбой, RST и т.п.).
 */
export const isChunkLoadError = (error: unknown): boolean => {
  if (!error) return false
  if (error instanceof Error) {
    const name = error.name || ''
    const message = error.message || ''
    return (
      name === 'ChunkLoadError' ||
      message.includes('Failed to fetch dynamically imported module') ||
      message.includes('Loading chunk') ||
      message.includes('Importing a module script failed')
    )
  }
  if (typeof error === 'string') {
    return (
      error.includes('Failed to fetch dynamically imported module') ||
      error.includes('Loading chunk') ||
      error.includes('Importing a module script failed')
    )
  }
  return false
}

/**
 * Выполняет одноразовую перезагрузку страницы при ошибке загрузки чанка.
 * Перед reload логирует инцидент в error_logs.
 * Возвращает true, если reload был инициирован, false — если уже выполнялся ранее в этой сессии.
 */
export const handleChunkLoadError = (error: unknown, component?: string | null): boolean => {
  // Защита от цикла: максимум один reload за сессию загрузки
  let alreadyReloaded = false
  try {
    alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG_KEY) === '1'
  } catch {
    // sessionStorage может быть недоступен (приватный режим, ограничения) — тогда reload не делаем
    return false
  }

  if (alreadyReloaded) return false

  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack ?? null : null

  logError({
    errorType: 'chunk_load_error',
    errorMessage: message,
    errorStack: stack,
    component: component ?? null,
  })

  try {
    sessionStorage.setItem(RELOAD_FLAG_KEY, '1')
  } catch {
    return false
  }

  // Небольшая задержка даёт шанс fire-and-forget логу уйти на сервер
  setTimeout(() => {
    window.location.reload()
  }, 150)

  return true
}
