/**
 * Хелперы аутентификации для E2E (план Iteration 9).
 *
 * uiLogin   — логин через форму (для role-based UI-сценариев).
 * apiLogin  — CSRF double-submit + POST /api/auth/login через APIRequestContext (cookies
 *             хранятся в контексте автоматически). Возвращает csrf-токен для последующих write.
 * getCsrf   — выдаёт/возвращает csrf-токен (нужен заголовок X-CSRF-Token на каждый write).
 *
 * Соответствует standalone-auth (server/src/routes/auth-standalone.ts):
 *   GET  /api/auth/csrf  → { csrfToken }  (+ cookie csrf_token)
 *   POST /api/auth/login { email, password }  (заголовок X-CSRF-Token обязателен)
 */
import { expect, type Page, type APIRequestContext } from '@playwright/test'
import { CREDS, type RoleCreds } from './config'

/** Логин через UI-форму; после успеха форма логина исчезает. */
export async function uiLogin(page: Page, creds: RoleCreds): Promise<void> {
  await page.goto('/login')
  await page.getByLabel(/e-?mail/i).fill(creds.email)
  await page.getByLabel(/пароль|password/i).fill(creds.password)
  await page.getByRole('button', { name: /войти|вход|sign in/i }).click()
  await expect(page.getByRole('button', { name: /войти|вход|sign in/i })).toHaveCount(0, {
    timeout: 15_000,
  })
}

/** Логин под ролью по имени (admin|user|counterparty|security). */
export function uiLoginAs(page: Page, role: keyof typeof CREDS): Promise<void> {
  return uiLogin(page, CREDS[role])
}

/** Получить csrf-токен (значение совпадает с cookie csrf_token — double-submit). */
export async function getCsrf(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/auth/csrf')
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { csrfToken: string | null }
  if (!body.csrfToken) throw new Error('csrfToken отсутствует в ответе /api/auth/csrf')
  return body.csrfToken
}

/** Логин через API: CSRF + login. Cookies сохраняются в request-контексте. Возвращает csrf. */
export async function apiLogin(request: APIRequestContext, creds: RoleCreds): Promise<string> {
  const csrf = await getCsrf(request)
  const res = await request.post('/api/auth/login', {
    headers: { 'x-csrf-token': csrf },
    data: { email: creds.email, password: creds.password },
  })
  expect(res.status(), `login ${creds.email}`).toBe(200)
  return csrf
}

/** Заголовки для write-запросов (CSRF double-submit). */
export function writeHeaders(csrf: string): Record<string, string> {
  return { 'x-csrf-token': csrf, 'content-type': 'application/json' }
}
