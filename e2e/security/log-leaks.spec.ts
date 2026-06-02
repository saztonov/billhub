/**
 * Security E2E: grep-snapshot по логам — 0 утечек секретов (план Iteration 9; snapshot-pattern
 * из Iteration 7 pino-redaction).
 *
 * Прогоняет чувствительные операции (неуспешный логин, password reset, опц. OCR), затем собирает
 * «стог»: error_logs (админ-API) + /api/ocr/logs + опц. pino-файл (LOG_FILE) — и проверяет, что в
 * нём НЕТ: plain-паролей, свежевыданного reset-токена, refresh-токенов, presigned-подписей
 * (X-Amz-Signature/Credential), JWT (eyJ…), OCR-фрагментов (recognized_text/material_name/ocr_response — значения).
 *
 * Прямой тест ADR/плана «password reset токен НЕ в audit_log»: сам токен НЕ должен встречаться в логах.
 */
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
import { apiLogin, writeHeaders } from '../helpers/auth'
import { CREDS, BASE_URL } from '../helpers/config'

const TARGET_EMAIL = process.env.E2E_RESET_EMAIL ?? CREDS.counterparty.email

/** Безопасно тянет JSON-ответ как строку (для grep). */
async function dump(ctx: APIRequestContext, url: string): Promise<string> {
  try {
    const res = await ctx.get(url)
    if (!res.ok()) return ''
    return JSON.stringify(await res.json())
  } catch {
    return ''
  }
}

test('grep-snapshot: 0 утечек plain-значений и OCR-фрагментов в логах', async () => {
  test.setTimeout(60_000)
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  const csrf = await apiLogin(ctx, CREDS.admin)

  // 1. Провоцируем события: неуспешный логин (другой контекст) и password reset.
  const badCtx = await pwRequest.newContext({ baseURL: BASE_URL })
  const badCsrf = await apiLogin(badCtx, CREDS.admin).catch(() => '')
  await badCtx
    .post('/api/auth/login', {
      headers: { 'x-csrf-token': badCsrf || csrf },
      data: { email: TARGET_EMAIL, password: 'leak-probe-WRONG-pass' },
    })
    .catch(() => {})
  await badCtx.dispose()

  const reqRes = await ctx.post('/api/auth/password/reset/request', {
    headers: writeHeaders(csrf),
    data: { email: TARGET_EMAIL },
  })
  const resetToken =
    reqRes.status() === 200 ? ((await reqRes.json()) as { resetToken: string }).resetToken : ''

  // 2. Собираем «стог» логов.
  let haystack = ''
  haystack += await dump(ctx, '/api/error-logs')
  haystack += await dump(ctx, '/api/ocr/logs')
  const logFile = process.env.LOG_FILE
  if (logFile && existsSync(logFile)) haystack += readFileSync(logFile, 'utf8')

  expect(
    haystack.length,
    'нет данных логов для grep (укажите LOG_FILE или проверьте админ-API)',
  ).toBeGreaterThan(0)

  // 3. Утечек быть не должно.
  const needles: Array<[string, string]> = [
    ['plain reset-токен', resetToken],
    ['plain пароль admin', CREDS.admin.password],
    ['plain пароль user', CREDS.user.password],
    ['plain пароль counterparty', CREDS.counterparty.password],
    ['проба неуспешного логина', 'leak-probe-WRONG-pass'],
    ['presigned signature', 'X-Amz-Signature'],
    ['presigned credential', 'X-Amz-Credential'],
    ['refresh cookie', 'refresh_token='],
    ['JWT', 'eyJ'],
  ]
  for (const [label, needle] of needles) {
    if (!needle) continue
    expect(haystack.includes(needle), `утечка в логах: ${label}`).toBe(false)
  }

  // 4. OCR-фрагменты: если ключи присутствуют в логах — только в редактированном виде.
  for (const key of ['recognized_text', 'material_name', 'ocr_response']) {
    if (haystack.includes(key)) {
      const around = haystack.slice(Math.max(0, haystack.indexOf(key)), haystack.indexOf(key) + 120)
      expect(around, `OCR-поле ${key} должно быть редактировано`).toMatch(
        /REDACTED|\*\*\*|"\[Redacted\]"/i,
      )
    }
  }
  await ctx.dispose()
})
