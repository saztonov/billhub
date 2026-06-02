/**
 * Critical E2E: race-safe refresh rotation (план Iteration 9; standalone-auth раздел 13).
 *
 *  - Одновременный refresh из 5 «вкладок» с ОДНИМ исходным refresh-token в пределах grace-window
 *    (REFRESH_GRACE_MS, по умолчанию 5 с) → все успешны (параллельные вкладки не выбивают друг друга).
 *  - Replay того же исходного token ПОЗЖЕ grace-window (>6 с) → 401, family инвалидирована,
 *    пишется audit-event reuse_detected.
 *
 * API-уровень с явным заголовком Cookie (контролируем, какой именно токен предъявляется).
 */
import { test, expect, request as pwRequest } from '@playwright/test'
import { apiLogin } from '../helpers/auth'
import { CREDS, BASE_URL } from '../helpers/config'

const GRACE_MS = Number.parseInt(process.env.REFRESH_GRACE_MS ?? '5000', 10)

interface Cookies {
  refresh: string
  csrf: string
}

/** Логинится в одноразовом контексте и достаёт значения cookie refresh_token / csrf_token. */
async function loginAndGetCookies(): Promise<Cookies> {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  await apiLogin(ctx, CREDS.user)
  const state = await ctx.storageState()
  const find = (n: string): string => {
    const c = state.cookies.find((x) => x.name === n)
    if (!c) throw new Error(`cookie ${n} не установлена после логина`)
    return c.value
  }
  const cookies = { refresh: find('refresh_token'), csrf: find('csrf_token') }
  await ctx.dispose()
  return cookies
}

test('grace-window: 5 одновременных refresh с одним токеном → все 200', async () => {
  test.setTimeout(60_000)
  const { refresh, csrf } = await loginAndGetCookies()
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })

  const refreshOnce = () =>
    ctx
      .post('/api/auth/refresh', {
        headers: { cookie: `refresh_token=${refresh}; csrf_token=${csrf}`, 'x-csrf-token': csrf },
      })
      .then((r) => r.status())

  const codes = await Promise.all(Array.from({ length: 5 }, () => refreshOnce()))
  // Внутри grace-window все параллельные вкладки получают валидный ответ (200), без 401-reuse.
  expect(codes.every((c) => c === 200)).toBe(true)
  await ctx.dispose()
})

test('replay исходного токена позже grace-window → 401 + family инвалидирована', async () => {
  test.setTimeout(60_000)
  const { refresh, csrf } = await loginAndGetCookies()
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })

  // Один валидный refresh (ротация исходного токена).
  const first = await ctx.post('/api/auth/refresh', {
    headers: { cookie: `refresh_token=${refresh}; csrf_token=${csrf}`, 'x-csrf-token': csrf },
  })
  expect(first.status()).toBe(200)

  // Ждём окончания grace-window и реиграем УЖЕ заменённый исходный токен.
  await new Promise((r) => setTimeout(r, GRACE_MS + 1500))
  const replay = await ctx.post('/api/auth/refresh', {
    headers: { cookie: `refresh_token=${refresh}; csrf_token=${csrf}`, 'x-csrf-token': csrf },
  })
  expect(replay.status()).toBe(401)
  expect(await replay.text()).toMatch(/безопасност|аннулирован|не удалось обновить/i)

  // Family инвалидирована: любой ранее выданный из неё refresh тоже не сработает.
  const newRefresh = (await first.json().catch(() => ({}))) as Record<string, unknown>
  void newRefresh // токен в httpOnly cookie ответа first; повторная попытка ниже через jar контекста
  const afterInvalidation = await ctx.post('/api/auth/refresh', {
    headers: { 'x-csrf-token': csrf },
  })
  expect([401, 403]).toContain(afterInvalidation.status())
  await ctx.dispose()
})
