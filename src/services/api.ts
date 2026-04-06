const BASE_URL = import.meta.env.VITE_API_URL || ''

/** Ошибка API с HTTP-статусом */
export class ApiError extends Error {
  status: number
  details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

/** Single-flight промис refresh — все параллельные 401 ждут один и тот же */
let refreshPromise: Promise<RefreshResult> | null = null

/** Результат refresh: успех + новое время истечения access_token (ms) */
interface RefreshResult {
  ok: boolean
  accessTokenExpiresAt?: number
}

/** Коллбэк, вызываемый при успешном refresh (обновляет authStore) */
type RefreshSuccessHandler = (accessTokenExpiresAt: number) => void
let onRefreshSuccess: RefreshSuccessHandler | null = null

/** Регистрация обработчика успешного refresh (вызывается из authStore) */
export function setRefreshSuccessHandler(handler: RefreshSuccessHandler | null): void {
  onRefreshSuccess = handler
}

/** Флаг: redirect на логин уже начался, новые запросы блокируются */
let isRedirecting = false

/** Валидация returnUrl: только относительные пути */
function safeReturnUrl(path: string): string {
  if (path.startsWith('/') && !path.startsWith('//')) return path
  return '/'
}

/** Редирект на страницу логина */
function redirectToLogin(): never {
  isRedirecting = true
  const returnUrl = safeReturnUrl(window.location.pathname + window.location.search)
  window.location.href = `/login?returnUrl=${encodeURIComponent(returnUrl)}`
  throw new ApiError(401, 'Требуется авторизация')
}

/** Внутренняя реализация запроса refresh */
async function doRefresh(): Promise<RefreshResult> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) return { ok: false }
    try {
      const body = (await res.json()) as { accessTokenExpiresAt?: number }
      const expiresAt = body?.accessTokenExpiresAt
      if (typeof expiresAt === 'number' && onRefreshSuccess) {
        onRefreshSuccess(expiresAt)
      }
      return { ok: true, accessTokenExpiresAt: expiresAt }
    } catch {
      /** Тело не JSON — считаем refresh успешным, но без времени истечения */
      return { ok: true }
    }
  } catch {
    return { ok: false }
  }
}

/**
 * Обновление access_token с single-flight гарантией:
 * все параллельные вызовы дожидаются одного и того же запроса.
 * Экспортируется для использования из проактивного таймера.
 */
export function refreshAccessToken(): Promise<RefreshResult> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

/** Дополнительные параметры запроса */
interface FetchOptions {
  /** Пропустить редирект на логин при 401 (для checkAuth) */
  skipAuthRedirect?: boolean
}

/** Базовый fetch-обёртка */
async function apiFetch<T>(url: string, options?: RequestInit, isRetry = false, fetchOptions?: FetchOptions): Promise<T> {
  // Блокируем запросы после начала redirect на логин
  if (isRedirecting) throw new ApiError(401, 'Требуется авторизация')

  const fullUrl = `${BASE_URL}${url}`
  const isFormData = options?.body instanceof FormData

  const isBlob = options?.body instanceof Blob || options?.body instanceof ArrayBuffer
  const headers = new Headers(options?.headers)
  if (!isFormData && !isBlob && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let res: Response
  try {
    res = await fetch(fullUrl, {
      ...options,
      headers,
      credentials: 'include',
    })
  } catch {
    throw new ApiError(0, 'Ошибка сети')
  }

  // Обработка 401: попытка refresh и повтор запроса
  if (res.status === 401 && !isRetry) {
    const result = await refreshAccessToken()
    if (result.ok) return apiFetch<T>(url, options, true, fetchOptions)
    if (fetchOptions?.skipAuthRedirect) {
      throw new ApiError(401, 'Требуется авторизация')
    }
    redirectToLogin()
  }

  if (res.status === 401) {
    if (fetchOptions?.skipAuthRedirect) {
      throw new ApiError(401, 'Требуется авторизация')
    }
    redirectToLogin()
  }

  if (!res.ok) {
    let details: unknown
    let message = res.statusText
    try {
      const body = await res.json()
      message = body.message || body.error || message
      details = body
    } catch { /* тело ответа не JSON */ }
    throw new ApiError(res.status, message, details)
  }

  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

/** Сериализация query-параметров */
function withParams(url: string, params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return url
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, String(v))
  }
  const qs = sp.toString()
  return qs ? `${url}?${qs}` : url
}

/** Удобные методы для HTTP-запросов */
export const api = {
  get: <T>(url: string, params?: Record<string, string | number | boolean | undefined>, fetchOptions?: FetchOptions) =>
    apiFetch<T>(withParams(url, params), undefined, false, fetchOptions),

  post: <T>(url: string, body?: unknown, fetchOptions?: FetchOptions) =>
    apiFetch<T>(url, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }, false, fetchOptions),

  put: <T>(url: string, body?: unknown) =>
    apiFetch<T>(url, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),

  patch: <T>(url: string, body?: unknown) =>
    apiFetch<T>(url, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),

  delete: <T>(url: string) =>
    apiFetch<T>(url, { method: 'DELETE' }),

  /** PUT с бинарным телом (для загрузки чанков файлов) */
  putBinary: <T>(url: string, data: Blob | ArrayBuffer, contentType = 'application/octet-stream') =>
    apiFetch<T>(url, {
      method: 'PUT',
      body: data,
      headers: { 'Content-Type': contentType },
    }),
} as const

/** SSE-подключение с автоматическим парсингом JSON */
export function apiSSE(
  url: string,
  onMessage: (data: unknown) => void,
  onError?: (err: Event) => void,
): () => void {
  const source = new EventSource(`${BASE_URL}${url}`, { withCredentials: true })

  source.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data))
    } catch {
      onMessage(event.data)
    }
  }

  if (onError) source.onerror = onError

  // Функция очистки для вызова при размонтировании
  return () => source.close()
}
