/**
 * Critical E2E: chunked upload 90 МБ через Redis-session с имитацией обрыва на 50% и resume
 * (план Iteration 9). API-уровень для точного контроля над частями.
 *
 * Флоу (server/src/routes/file-proxy.ts):
 *   POST /api/files/upload/init            → { uploadId, fileKey, partSize, totalParts }
 *   PUT  /api/files/upload/:id/part/:n     (тело — сырые байты части)
 *   GET  /api/files/upload/:id/status      → прогресс (какие части загружены)
 *   POST /api/files/upload/:id/complete    → финализация S3 multipart
 *
 * Принцип 7: redis-data persistent — сессия загрузки переживает «обрыв» (новый набор PUT-ов
 * продолжает ту же сессию). Resume = докачка недостающих частей после паузы.
 *
 * Требует E2E_CP_NAME (имя контрагента подрядчика — для S3-ключа general). Без него — skip.
 */
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import { apiLogin, writeHeaders } from '../helpers/auth'
import { CREDS, BASE_URL } from '../helpers/config'

const CP_NAME = process.env.E2E_CP_NAME ?? ''
const FILE_SIZE = 90 * 1024 * 1024 // 90 МБ

test.describe.configure({ mode: 'serial' })

test('chunked upload 90 МБ: обрыв на 50% → resume → complete', async () => {
  test.skip(!CP_NAME, 'Задайте E2E_CP_NAME (имя контрагента подрядчика) для chunked-upload теста')
  test.setTimeout(300_000)

  const ctx: APIRequestContext = await pwRequest.newContext({ baseURL: BASE_URL })
  const csrf = await apiLogin(ctx, CREDS.counterparty)

  // 1. init multipart-сессии.
  const initRes = await ctx.post('/api/files/upload/init', {
    headers: writeHeaders(csrf),
    data: {
      fileName: `e2e-large-${Date.now()}.pdf`,
      contentType: 'application/pdf',
      fileSize: FILE_SIZE,
      context: 'general',
      counterpartyName: CP_NAME,
    },
  })
  expect(initRes.status(), await initRes.text()).toBe(200)
  const init = (await initRes.json()) as {
    uploadId: string
    fileKey: string
    partSize: number
    totalParts: number
  }
  expect(init.totalParts).toBeGreaterThan(1)

  const part = Buffer.alloc(init.partSize, 0x41) // одна часть, переиспользуем буфер
  const lastSize = FILE_SIZE - init.partSize * (init.totalParts - 1)

  const putPart = (n: number): Promise<number> => {
    const body = n === init.totalParts ? part.subarray(0, lastSize) : part
    return ctx
      .put(`/api/files/upload/${init.uploadId}/part/${n}`, {
        headers: { 'x-csrf-token': csrf, 'content-type': 'application/octet-stream' },
        data: body,
      })
      .then((r) => r.status())
  }

  // 2. Загружаем ПЕРВУЮ половину частей, затем имитируем обрыв (просто прекращаем).
  const half = Math.floor(init.totalParts / 2)
  for (let n = 1; n <= half; n += 1) {
    expect(await putPart(n)).toBe(200)
  }

  // 3. status подтверждает частичную загрузку (сессия жива в Redis).
  const statusRes = await ctx.get(`/api/files/upload/${init.uploadId}/status`)
  expect(statusRes.status()).toBe(200)
  const status = (await statusRes.json()) as { uploadedParts?: number; totalParts?: number }
  if (typeof status.uploadedParts === 'number') {
    expect(status.uploadedParts).toBeGreaterThanOrEqual(half)
    expect(status.uploadedParts).toBeLessThan(init.totalParts)
  }

  // 4. RESUME: докачиваем оставшиеся части по той же сессии.
  for (let n = half + 1; n <= init.totalParts; n += 1) {
    expect(await putPart(n)).toBe(200)
  }

  // 5. complete финализирует объект.
  const completeRes = await ctx.post(`/api/files/upload/${init.uploadId}/complete`, {
    headers: writeHeaders(csrf),
    data: {},
  })
  expect(completeRes.status(), await completeRes.text()).toBe(200)

  // 6. cleanup: удаляем загруженный объект (тест идемпотентен на копии данных).
  await ctx
    .delete(`/api/files/${init.fileKey}`, { headers: { 'x-csrf-token': csrf } })
    .catch(() => {})
  await ctx.dispose()
})
