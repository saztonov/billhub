/**
 * Security E2E: контроль доступа (план Iteration 9).
 *
 *  - JWT с чужим aud (или невалидный) → 401;
 *  - counterparty_user → чужая заявка/файл → 403 (+ audit-event forbidden_access);
 *  - SQL-injection через свободные поля → отбита zod + Drizzle prepared statements (НЕ 500, БД цела);
 *  - rate-limit: 6-я попытка /auth/login в окне 5 мин → 429.
 *
 * API-уровень.
 */
import { test, expect, request as pwRequest } from '@playwright/test'
import { apiLogin, getCsrf } from '../helpers/auth'
import { CREDS, BASE_URL } from '../helpers/config'

test('JWT с чужим aud / невалидный access_token → 401', async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  // Заведомо невалидный токен.
  const garbage = await ctx.get('/api/auth/me', {
    headers: { cookie: 'access_token=eyJ.invalid.forged' },
  })
  expect(garbage.status()).toBe(401)

  // Токен, подписанный нашим ключом, но с ЧУЖИМ aud (оператор готовит его заранее) → тоже 401.
  const wrongAud = process.env.E2E_WRONG_AUD_TOKEN
  if (wrongAud) {
    const res = await ctx.get('/api/auth/me', { headers: { cookie: `access_token=${wrongAud}` } })
    expect(res.status()).toBe(401)
  }
  await ctx.dispose()
})

test('counterparty_user → чужой файл → 403', async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  await apiLogin(ctx, CREDS.counterparty)
  // Ключ под папкой ДРУГОГО контрагента — verifyCounterpartyOwnership вернёт false → 403.
  const foreignKey = process.env.E2E_FOREIGN_FILE_KEY ?? 'chuzhoj-kontragent/secret/secret.pdf'
  const res = await ctx.get(`/api/files/download-url/${foreignKey}`)
  expect(res.status()).toBe(403)
  await ctx.dispose()
})

test('SQL-injection через свободные поля → не 500, БД цела', async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  const csrf = await apiLogin(ctx, CREDS.counterparty)
  const payload = "'; DROP TABLE users; --"

  // Свободное поле fileName: zod-валидация + prepared statements нейтрализуют инъекцию.
  const res = await ctx.post('/api/files/upload-url', {
    headers: { 'x-csrf-token': csrf, 'content-type': 'application/json' },
    data: {
      fileName: `${payload}.pdf`,
      contentType: 'application/pdf',
      context: 'general',
      counterpartyName: payload,
    },
  })
  // Допустимо: 400 (валидация/доступ) или 200 (имя сохранено как литерал) — но НИКОГДА 500.
  expect(res.status()).not.toBe(500)

  // БД цела: таблица users существует, аутентификация работает.
  const me = await ctx.get('/api/auth/me')
  expect(me.status()).toBe(200)
  await ctx.dispose()
})

test('rate-limit: 6-я попытка /api/auth/login в окне → 429', async () => {
  test.setTimeout(30_000)
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  const csrf = await getCsrf(ctx)
  const attempt = () =>
    ctx
      .post('/api/auth/login', {
        headers: { 'x-csrf-token': csrf },
        data: { email: CREDS.user.email, password: 'definitely-wrong-password' },
      })
      .then((r) => r.status())

  const codes: number[] = []
  for (let i = 0; i < 6; i += 1) codes.push(await attempt())
  expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true)
  expect(codes[5]).toBe(429)
  await ctx.dispose()
})
