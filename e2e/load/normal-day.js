// k6: «Обычный день» — 50 одновременных пользователей × 30 мин (план Iteration 9).
//
// Профиль: 70% read / 20% write / 10% upload (1–10 МБ presigned).
// SLO (под 2 CPU / 4 GB): p95 < 1000 мс (скорректировано с 800 мс), error rate < 0.5%,
//   PG pool < 80% от conn_limit=30 (проверяется out-of-band — см. ниже).
//
// Запуск: SMOKE_BASE_URL=https://<temp> k6 run e2e/load/normal-day.js
// PG pool: параллельно держать `scripts/check-pg-latency.ts` или cron-монитор
//   `SELECT count(*) FROM pg_stat_activity WHERE usename='billhub_runtime'` (порог < 24 из 30).
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter } from 'k6/metrics'
import { BASE, USERS, CP_NAME, login, jsonHeaders, randomFileSize, pick } from './lib/common.js'

const serverErrors = new Counter('server_errors_5xx')

export const options = {
  scenarios: {
    normal_day: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 50),
      duration: __ENV.DURATION || '30m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000'], // SLO p95 (2 CPU)
    http_req_failed: ['rate<0.005'], // error rate < 0.5%
    server_errors_5xx: ['count<1'],
    'http_req_duration{kind:read}': ['p(95)<800'],
    'http_req_duration{kind:write}': ['p(95)<1200'],
  },
}

const READ_ENDPOINTS = [
  '/api/auth/me',
  '/api/payment-requests',
  '/api/contract-requests',
  '/api/notifications',
  '/api/references/counterparties',
]

export function setup() {
  // Прогреваем — общая проверка доступности.
  const r = http.get(`${BASE}/health/ready`)
  check(r, { 'health ready': (res) => res.status === 200 })
}

export default function () {
  const csrf = login(USERS.user)
  const roll = Math.random()

  if (roll < 0.7) {
    // READ (70%)
    const res = http.get(`${BASE}${pick(READ_ENDPOINTS)}`, { tags: { kind: 'read' } })
    if (res.status >= 500) serverErrors.add(1)
    check(res, { 'read < 500': (r) => r.status < 500 })
  } else if (roll < 0.9) {
    // WRITE (20%) — лёгкий write: пометка уведомления прочитанным / no-op-safe запрос.
    const res = http.post(`${BASE}/api/notifications/read-all`, '{}', {
      headers: jsonHeaders(csrf),
      tags: { kind: 'write' },
    })
    if (res.status >= 500) serverErrors.add(1)
    check(res, { 'write < 500': (r) => r.status < 500 })
  } else {
    // UPLOAD (10%) — presign 1–10 МБ (presigned PUT в S3 — отдельная фаза, тут только выдача URL).
    if (CP_NAME) {
      const size = randomFileSize(1, 10)
      const res = http.post(
        `${BASE}/api/files/upload-url`,
        JSON.stringify({
          fileName: `load-${__VU}-${__ITER}.pdf`,
          contentType: 'application/pdf',
          context: 'general',
          counterpartyName: CP_NAME,
        }),
        { headers: jsonHeaders(csrf), tags: { kind: 'write' } },
      )
      if (res.status >= 500) serverErrors.add(1)
      check(res, { 'presign 200': (r) => r.status === 200 })
      // (Реальная заливка size байт в presigned URL — в parallel-upload.js; здесь меряем backend.)
      void size
    }
  }

  sleep(1 + Math.random() * 2) // think-time 1–3 с
}
