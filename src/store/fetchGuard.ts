// Общие защиты fetch-вызовов zustand-сторов: дедупликация одновременных
// запросов (single-flight) и проверка свежести кэша (TTL).

const inFlight = new Map<string, Promise<unknown>>()

/**
 * Single-flight: повторный вызов с тем же ключом, пока предыдущий запрос не
 * завершился, получает тот же promise — второй HTTP-запрос не отправляется.
 * Страхует от дублирующихся эффектов и гонок «два ответа перезаписывают друг друга».
 */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing as Promise<T>
  const p = fn().finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

/** true, если данные загружались и ещё свежее ttlMs — сеть не нужна. */
export function isFresh(lastFetchedAt: number | null, ttlMs: number): boolean {
  return lastFetchedAt !== null && Date.now() - lastFetchedAt < ttlMs
}

/** TTL справочников по умолчанию: меняются редко, 5 минут достаточно. */
export const REFERENCE_TTL_MS = 5 * 60 * 1000
