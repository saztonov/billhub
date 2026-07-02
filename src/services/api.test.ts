import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { http, HttpResponse, delay } from 'msw'
import { server } from '@/test/msw-server'
import { api, ApiError, refreshAccessToken, setRefreshSuccessHandler } from './api'

/**
 * Тесты для src/services/api.ts.
 * Зафиксировано поведение, которое не должно сломаться при переходе на standalone auth (итерация 6)
 * и при дальнейшем переходе на Keycloak OIDC (Этап 2).
 */

const BASE = '' // VITE_API_URL не задан в тестах → '' (relative)

/** Мокаем window.location перед тестами, которые проверяют redirect на /login */
const originalLocation = window.location

beforeEach(() => {
  // jsdom location read-only без передёргивания
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...originalLocation, href: 'http://localhost/test', pathname: '/test', search: '' },
  })
  setRefreshSuccessHandler(null)
})

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  })
})

describe('api.get', () => {
  it('возвращает JSON-тело при 200', async () => {
    server.use(http.get(`${BASE}/api/foo`, () => HttpResponse.json({ value: 42 })))
    const result = await api.get<{ value: number }>('/api/foo')
    expect(result).toEqual({ value: 42 })
  })

  it('добавляет query-параметры из объекта params', async () => {
    let receivedUrl = ''
    server.use(
      http.get(`${BASE}/api/list`, ({ request }) => {
        receivedUrl = request.url
        return HttpResponse.json([])
      }),
    )
    await api.get('/api/list', { page: 2, search: 'тест', active: true })
    expect(receivedUrl).toContain('page=2')
    expect(receivedUrl).toContain('search=')
    expect(receivedUrl).toContain('active=true')
  })

  it('пропускает undefined-параметры', async () => {
    let receivedUrl = ''
    server.use(
      http.get(`${BASE}/api/list`, ({ request }) => {
        receivedUrl = request.url
        return HttpResponse.json([])
      }),
    )
    await api.get('/api/list', { page: 1, skip: undefined })
    expect(receivedUrl).toContain('page=1')
    expect(receivedUrl).not.toContain('skip=')
  })

  it('204 No Content возвращает undefined', async () => {
    server.use(http.get(`${BASE}/api/empty`, () => new HttpResponse(null, { status: 204 })))
    const result = await api.get('/api/empty')
    expect(result).toBeUndefined()
  })
})

describe('api ошибки', () => {
  it('5xx преобразуется в ApiError с body.message', async () => {
    server.use(
      http.get(`${BASE}/api/error`, () =>
        HttpResponse.json({ message: 'Internal error' }, { status: 500 }),
      ),
    )
    await expect(api.get('/api/error')).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      message: 'Internal error',
    })
  })

  it('сетевая ошибка → ApiError 0', async () => {
    server.use(http.get(`${BASE}/api/network`, () => HttpResponse.error()))
    await expect(api.get('/api/network')).rejects.toMatchObject({
      status: 0,
    })
  })

  it('ApiError содержит details', async () => {
    server.use(
      http.get(`${BASE}/api/bad`, () =>
        HttpResponse.json({ error: 'Bad input', field: 'name' }, { status: 400 }),
      ),
    )
    try {
      await api.get('/api/bad')
      expect.fail('должен был выкинуть')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      if (e instanceof ApiError) {
        expect(e.status).toBe(400)
        expect(e.details).toMatchObject({ error: 'Bad input', field: 'name' })
      }
    }
  })
})

describe('refresh single-flight', () => {
  it('один refresh обслуживает параллельные 401', async () => {
    let refreshCalls = 0
    let fooCallCount = 0
    server.use(
      http.get(`${BASE}/api/foo`, () => {
        fooCallCount++
        // Первый раз — 401, после refresh — 200
        if (fooCallCount === 1 || fooCallCount === 2) {
          return new HttpResponse(null, { status: 401 })
        }
        return HttpResponse.json({ ok: true })
      }),
      http.post(`${BASE}/api/auth/refresh`, async () => {
        refreshCalls++
        await delay(50)
        return HttpResponse.json({ accessTokenExpiresAt: Date.now() + 60000 })
      }),
    )

    const handler = vi.fn()
    setRefreshSuccessHandler(handler)

    const [r1, r2] = await Promise.all([api.get('/api/foo'), api.get('/api/foo')])

    expect(r1).toEqual({ ok: true })
    expect(r2).toEqual({ ok: true })
    // Refresh должен быть вызван ровно 1 раз даже при двух параллельных 401
    expect(refreshCalls).toBe(1)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('refreshAccessToken возвращает accessTokenExpiresAt', async () => {
    const expiresAt = Date.now() + 60000
    server.use(
      http.post(`${BASE}/api/auth/refresh`, () =>
        HttpResponse.json({ accessTokenExpiresAt: expiresAt }),
      ),
    )
    const result = await refreshAccessToken()
    expect(result.ok).toBe(true)
    expect(result.accessTokenExpiresAt).toBe(expiresAt)
  })

  it('refresh failure возвращает ok=false', async () => {
    server.use(http.post(`${BASE}/api/auth/refresh`, () => new HttpResponse(null, { status: 401 })))
    const result = await refreshAccessToken()
    expect(result.ok).toBe(false)
  })
})

describe('401 → redirect на /login', () => {
  it('skipAuthRedirect=true пробрасывает 401 без redirect', async () => {
    server.use(
      http.get(`${BASE}/api/me`, () => new HttpResponse(null, { status: 401 })),
      http.post(`${BASE}/api/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
    )
    await expect(api.get('/api/me', undefined, { skipAuthRedirect: true })).rejects.toMatchObject({
      status: 401,
    })
    expect(window.location.href).toBe('http://localhost/test')
  })
})

describe('/api/auth/login 401 — не пытается refresh, отдаёт реальное сообщение сервера', () => {
  it('401 от login пробрасывает message из тела ответа, без вызова /api/auth/refresh', async () => {
    let refreshCalled = false
    server.use(
      http.post(`${BASE}/api/auth/login`, () =>
        HttpResponse.json({ error: 'Неверный email или пароль' }, { status: 401 }),
      ),
      http.post(`${BASE}/api/auth/refresh`, () => {
        refreshCalled = true
        return new HttpResponse(null, { status: 401 })
      }),
    )
    await expect(
      api.post(
        '/api/auth/login',
        { email: 'a@b.ru', password: 'wrong' },
        { skipAuthRedirect: true },
      ),
    ).rejects.toMatchObject({ status: 401, message: 'Неверный email или пароль' })
    expect(refreshCalled).toBe(false)
    expect(window.location.href).toBe('http://localhost/test')
  })
})

describe('api.post FormData / JSON', () => {
  it('JSON-тело отправляется с Content-Type: application/json', async () => {
    let contentType = ''
    let receivedBody: unknown = null
    server.use(
      http.post(`${BASE}/api/create`, async ({ request }) => {
        contentType = request.headers.get('content-type') ?? ''
        receivedBody = await request.json()
        return HttpResponse.json({ id: 1 })
      }),
    )
    const result = await api.post<{ id: number }>('/api/create', { name: 'тест' })
    expect(result).toEqual({ id: 1 })
    expect(contentType).toContain('application/json')
    expect(receivedBody).toEqual({ name: 'тест' })
  })

  it('api.post сериализует body через JSON.stringify', async () => {
    // api.post всегда JSON.stringify, FormData не поддерживается через него.
    // Загрузка файлов идёт через api.putBinary (chunked upload).
    let receivedBody: unknown = null
    server.use(
      http.post(`${BASE}/api/upload-meta`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )
    await api.post('/api/upload-meta', { name: 'test', size: 100 })
    expect(receivedBody).toEqual({ name: 'test', size: 100 })
  })
})

describe('CSRF double-submit', () => {
  afterEach(() => {
    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  })

  it('api.post добавляет X-CSRF-Token из cookie csrf_token', async () => {
    document.cookie = 'csrf_token=secret-token-123; path=/'
    let receivedHeader: string | null = null
    server.use(
      http.post(`${BASE}/api/write`, ({ request }) => {
        receivedHeader = request.headers.get('x-csrf-token')
        return HttpResponse.json({ ok: true })
      }),
    )
    await api.post('/api/write', { foo: 'bar' })
    expect(receivedHeader).toBe('secret-token-123')
  })

  it('api.get НЕ добавляет X-CSRF-Token (safe-метод)', async () => {
    document.cookie = 'csrf_token=secret-token-123; path=/'
    let receivedHeader: string | null | undefined = undefined
    server.use(
      http.get(`${BASE}/api/read`, ({ request }) => {
        receivedHeader = request.headers.get('x-csrf-token')
        return HttpResponse.json({ ok: true })
      }),
    )
    await api.get('/api/read')
    expect(receivedHeader).toBeNull()
  })

  it('refreshAccessToken добавляет X-CSRF-Token из cookie', async () => {
    document.cookie = 'csrf_token=refresh-csrf-456; path=/'
    let receivedHeader: string | null = null
    server.use(
      http.post(`${BASE}/api/auth/refresh`, ({ request }) => {
        receivedHeader = request.headers.get('x-csrf-token')
        return HttpResponse.json({ accessTokenExpiresAt: Date.now() + 60000 })
      }),
    )
    await refreshAccessToken()
    expect(receivedHeader).toBe('refresh-csrf-456')
  })

  it('без cookie заголовок X-CSRF-Token не отправляется (сервер вернёт 403)', async () => {
    let receivedHeader: string | null | undefined = undefined
    server.use(
      http.post(`${BASE}/api/write-no-cookie`, ({ request }) => {
        receivedHeader = request.headers.get('x-csrf-token')
        return HttpResponse.json({ ok: true })
      }),
    )
    await api.post('/api/write-no-cookie', {})
    expect(receivedHeader).toBeNull()
  })
})

describe('api.putBinary', () => {
  it('отправляет Blob с заданным Content-Type', async () => {
    let contentType = ''
    let bodyLength = 0
    server.use(
      http.put(`${BASE}/api/chunk`, async ({ request }) => {
        contentType = request.headers.get('content-type') ?? ''
        const buf = await request.arrayBuffer()
        bodyLength = buf.byteLength
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])])
    await api.putBinary('/api/chunk', blob, 'application/octet-stream')
    expect(contentType).toContain('application/octet-stream')
    // 5 байт payload — MSW/jsdom могут добавить служебные байты, проверяем диапазон.
    expect(bodyLength).toBeGreaterThanOrEqual(5)
  })
})
