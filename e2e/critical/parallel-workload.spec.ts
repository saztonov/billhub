/**
 * Critical E2E: параллельная нагрузка (план Iteration 9).
 *
 *  - 10 одновременных counterparty_user presign-загрузок (upload-url) — конкурентность S3-ключей;
 *  - 5 одновременных user-согласований разных заявок;
 *  - race-test на approvals state-machine: 2 одновременных /api/approvals/decide по ОДНОЙ заявке →
 *    ровно один успех, второй получает ошибку устаревшего состояния (атомарность перехода).
 *
 * API-уровень, несколько изолированных контекстов. Части, требующие конкретных id, гейтятся ENV.
 */
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import { apiLogin, writeHeaders } from '../helpers/auth'
import { CREDS, BASE_URL } from '../helpers/config'

const CP_NAME = process.env.E2E_CP_NAME ?? ''
const RACE_REQUEST_ID = process.env.E2E_APPROVAL_REQUEST_ID ?? ''
const RACE_REQUEST_IDS = (process.env.E2E_APPROVAL_REQUEST_IDS ?? '').split(',').filter(Boolean)

test('10 одновременных presign-загрузок подрядчика → все 200, ключи уникальны', async () => {
  test.skip(!CP_NAME, 'Задайте E2E_CP_NAME для presign-конкурентности')
  test.setTimeout(60_000)
  const ctx: APIRequestContext = await pwRequest.newContext({ baseURL: BASE_URL })
  const csrf = await apiLogin(ctx, CREDS.counterparty)

  const presign = (i: number) =>
    ctx
      .post('/api/files/upload-url', {
        headers: writeHeaders(csrf),
        data: {
          fileName: `e2e-parallel-${i}.pdf`,
          contentType: 'application/pdf',
          context: 'general',
          counterpartyName: CP_NAME,
        },
      })
      .then(async (r) => ({
        status: r.status(),
        key: (await r.json().catch(() => ({}))).fileKey as string | undefined,
      }))

  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => presign(i)))
  expect(results.every((r) => r.status === 200)).toBe(true)
  const keys = results.map((r) => r.key).filter(Boolean)
  expect(new Set(keys).size).toBe(keys.length) // ключи уникальны (timestamp + имя)
  await ctx.dispose()
})

test('5 одновременных согласований разных заявок сотрудником', async () => {
  test.skip(RACE_REQUEST_IDS.length < 5, 'Задайте E2E_APPROVAL_REQUEST_IDS (≥5 id через запятую)')
  test.setTimeout(60_000)
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  const csrf = await apiLogin(ctx, CREDS.user)

  const decide = (id: string) =>
    ctx
      .post('/api/approvals/decide', {
        headers: writeHeaders(csrf),
        data: { paymentRequestId: id, decision: 'approved' },
      })
      .then((r) => r.status())

  const codes = await Promise.all(RACE_REQUEST_IDS.slice(0, 5).map(decide))
  // Все валидные согласования разных заявок проходят (или возвращают доменный 4xx, но не 5xx).
  expect(codes.every((c) => c < 500)).toBe(true)
  await ctx.dispose()
})

test('race на approvals state-machine: 2 одновременных decide по одной заявке → ровно 1 успех', async () => {
  test.skip(!RACE_REQUEST_ID, 'Задайте E2E_APPROVAL_REQUEST_ID (заявка на согласовании)')
  test.setTimeout(60_000)
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  const csrf = await apiLogin(ctx, CREDS.user)

  const decide = () =>
    ctx
      .post('/api/approvals/decide', {
        headers: writeHeaders(csrf),
        data: { paymentRequestId: RACE_REQUEST_ID, decision: 'approved' },
      })
      .then((r) => r.status())

  const [a, b] = await Promise.all([decide(), decide()])
  const successes = [a, b].filter((c) => c === 200).length
  // Атомарный переход состояния: ровно один успех, второй — доменная ошибка устаревшего состояния.
  expect(successes).toBe(1)
  expect([a, b].some((c) => c >= 400 && c < 500)).toBe(true)
  await ctx.dispose()
})
