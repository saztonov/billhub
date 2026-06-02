// k6: «Параллельный chunked upload» — 20 пользователей × 50 МБ (план Iteration 9).
//
// SLO: все 20 файлов загружены, uploadSemaphore ограничивает параллелизм заливки частей в S3,
//   S3 не возвращает throttle (5xx/SlowDown). Проверяет chunked-upload путь (Redis-session).
//
// Требует E2E_CP_NAME (имя контрагента подрядчика — для S3-ключа). Без него сценарий — no-op.
// Запуск: E2E_CP_NAME="<Контрагент>" SMOKE_BASE_URL=https://<temp> k6 run e2e/load/parallel-upload.js
import http from 'k6/http'
import { check } from 'k6'
import { Counter } from 'k6/metrics'
import { BASE, USERS, CP_NAME, login, jsonHeaders } from './lib/common.js'

const FILE_SIZE = Number(__ENV.UPLOAD_SIZE_MB || 50) * 1024 * 1024
const throttles = new Counter('s3_throttle_5xx')
const completed = new Counter('uploads_completed')

export const options = {
  scenarios: {
    parallel_upload: {
      executor: 'per-vu-iterations',
      vus: Number(__ENV.UPLOAD_VUS || 20), // 20 пользователей
      iterations: 1, // каждый грузит один 50 МБ файл
      maxDuration: '30m',
    },
  },
  thresholds: {
    s3_throttle_5xx: ['count<1'], // S3 не троттлит
    uploads_completed: [`count>=${Number(__ENV.UPLOAD_VUS || 20)}`], // все 20 завершены
    http_req_failed: ['rate<0.02'],
  },
}

export default function () {
  if (!CP_NAME) return
  const csrf = login(USERS.counterparty)

  // 1. init multipart-сессии.
  const initRes = http.post(
    `${BASE}/api/files/upload/init`,
    JSON.stringify({
      fileName: `parallel-${__VU}.pdf`,
      contentType: 'application/pdf',
      fileSize: FILE_SIZE,
      context: 'general',
      counterpartyName: CP_NAME,
    }),
    { headers: jsonHeaders(csrf) },
  )
  if (!check(initRes, { 'init 200': (r) => r.status === 200 })) return
  const init = initRes.json()
  const partSize = init.partSize
  const totalParts = init.totalParts
  const part = new Uint8Array(partSize).buffer // одна часть, переиспользуем

  // 2. Последовательная заливка частей (uploadSemaphore на бэкенде ограничивает фактический параллелизм).
  for (let n = 1; n <= totalParts; n += 1) {
    const isLast = n === totalParts
    const body = isLast ? new Uint8Array(FILE_SIZE - partSize * (totalParts - 1)).buffer : part
    const res = http.put(`${BASE}/api/files/upload/${init.uploadId}/part/${n}`, body, {
      headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/octet-stream' },
    })
    if (res.status >= 500) throttles.add(1)
    if (!check(res, { 'part < 500': (r) => r.status < 500 })) return
  }

  // 3. complete.
  const completeRes = http.post(`${BASE}/api/files/upload/${init.uploadId}/complete`, '{}', {
    headers: jsonHeaders(csrf),
  })
  if (check(completeRes, { 'complete 200': (r) => r.status === 200 })) {
    completed.add(1)
  }

  // 4. cleanup.
  http.del(`${BASE}/api/files/${init.fileKey}`, null, { headers: { 'X-CSRF-Token': csrf } })
}
