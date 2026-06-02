/**
 * Critical E2E: password reset (план Iteration 9; standalone-auth раздел 13).
 *
 *  - admin запрашивает reset → plain-токен возвращается ОДНОКРАТНО в защищённом API-ответе админа;
 *  - confirm с plain-токеном меняет пароль; старый пароль перестаёт работать, новый работает;
 *  - plain-токен НЕ попадает в audit_log (см. также e2e/security/log-leaks.spec.ts — grep-snapshot).
 *
 * API-уровень. Цель reset — отдельный пользователь (E2E_RESET_EMAIL), чтобы не ломать основные учётки;
 * по умолчанию — учётка counterparty, пароль восстанавливается в конце.
 */
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import { apiLogin, getCsrf, writeHeaders } from '../helpers/auth'
import { CREDS, BASE_URL } from '../helpers/config'

const TARGET_EMAIL = process.env.E2E_RESET_EMAIL ?? CREDS.counterparty.email
const ORIGINAL_PASSWORD = process.env.E2E_RESET_PASSWORD ?? CREDS.counterparty.password

test.describe.configure({ mode: 'serial' })

/** Пытается залогиниться в одноразовом контексте, возвращает HTTP-код login. */
async function tryLogin(email: string, password: string): Promise<number> {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  const csrf = await getCsrf(ctx)
  const res = await ctx.post('/api/auth/login', {
    headers: { 'x-csrf-token': csrf },
    data: { email, password },
  })
  const code = res.status()
  await ctx.dispose()
  return code
}

test('password reset: request → confirm → старый пароль не работает, новый работает', async () => {
  test.setTimeout(60_000)
  const newPassword = `E2E-reset-${Date.now()}`

  // 1. admin запрашивает reset — получает plain-токен в ответе (copy-once).
  const admin: APIRequestContext = await pwRequest.newContext({ baseURL: BASE_URL })
  const csrf = await apiLogin(admin, CREDS.admin)
  const reqRes = await admin.post('/api/auth/password/reset/request', {
    headers: writeHeaders(csrf),
    data: { email: TARGET_EMAIL },
  })
  expect(reqRes.status(), await reqRes.text()).toBe(200)
  const body = (await reqRes.json()) as { resetToken: string; tokenId: string; expiresAt: string }
  expect(body.resetToken).toBeTruthy()
  expect(body.tokenId).toBeTruthy()
  // tokenId — это id записи (для audit), НЕ сам секрет; они различаются.
  expect(body.resetToken).not.toBe(body.tokenId)
  await admin.dispose()

  // 2. confirm с plain-токеном (CSRF нужен, но эндпоинт не требует логина).
  const confirmCtx = await pwRequest.newContext({ baseURL: BASE_URL })
  const ccsrf = await getCsrf(confirmCtx)
  const confirmRes = await confirmCtx.post('/api/auth/password/reset/confirm', {
    headers: { 'x-csrf-token': ccsrf },
    data: { token: body.resetToken, newPassword },
  })
  expect(confirmRes.status(), await confirmRes.text()).toBe(200)
  await confirmCtx.dispose()

  // 3. Старый пароль больше не работает, новый — работает.
  expect(await tryLogin(TARGET_EMAIL, ORIGINAL_PASSWORD)).toBe(401)
  expect(await tryLogin(TARGET_EMAIL, newPassword)).toBe(200)

  // 4. Восстанавливаем исходный пароль через ещё один reset-цикл (идемпотентность набора).
  const admin2 = await pwRequest.newContext({ baseURL: BASE_URL })
  const csrf2 = await apiLogin(admin2, CREDS.admin)
  const req2 = await admin2.post('/api/auth/password/reset/request', {
    headers: writeHeaders(csrf2),
    data: { email: TARGET_EMAIL },
  })
  const body2 = (await req2.json()) as { resetToken: string }
  await admin2.dispose()

  const restoreCtx = await pwRequest.newContext({ baseURL: BASE_URL })
  const rcsrf = await getCsrf(restoreCtx)
  await restoreCtx.post('/api/auth/password/reset/confirm', {
    headers: { 'x-csrf-token': rcsrf },
    data: { token: body2.resetToken, newPassword: ORIGINAL_PASSWORD },
  })
  await restoreCtx.dispose()
  expect(await tryLogin(TARGET_EMAIL, ORIGINAL_PASSWORD)).toBe(200)
})
