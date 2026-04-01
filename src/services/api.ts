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

/** Флаг предотвращения повторного refresh */
let isRefreshing = false

/** Валидация returnUrl: только относительные пути */
function safeReturnUrl(path: string): string {
  if (path.startsWith('/') && !path.startsWith('//')) return path
  return '/'
}

/** Редирект на страницу логина */
function redirectToLogin(): never {
  const returnUrl = safeReturnUrl(window.location.pathname + window.location.search)
  window.location.href = `/login?returnUrl=${encodeURIComponent(returnUrl)}`
  throw new ApiError(401, 'Требуется авторизация')
}

/** Попытка обновить токен */
async function tryRefresh(): Promise<boolean> {
  if (isRefreshing) return false
  isRefreshing = true
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    return res.ok
  } catch {
    return false
  } finally {
    isRefreshing = false
  }
}

/** Дополнительные параметры запроса */
interface FetchOptions {
  /** Пропустить редирект на логин при 401 (для checkAuth) */
  skipAuthRedirect?: boolean
}

/** Базовый fetch-обёртка */
async function apiFetch<T>(url: string, options?: RequestInit, isRetry = false, fetchOptions?: FetchOptions): Promise<T> {
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
    const refreshed = await tryRefresh()
    if (refreshed) return apiFetch<T>(url, options, true, fetchOptions)
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
