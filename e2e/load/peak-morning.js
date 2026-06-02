// k6: «Пик утра» — ramp до 100 VU за 5 мин, удержание 15 мин (план Iteration 9).
//
// Профиль: повышенная доля upload (30%).
// SLO (под 2 CPU / 4 GB): p95 < 2000 мс, 5xx = 0, dead jobs = 0.
//   dead jobs проверяется out-of-band: `SELECT count(*) FROM jobs_log WHERE status='dead'
//   AND created_at > now() - interval '1 hour'` == 0 (монитор Iteration 7).
//
// Запуск: SMOKE_BASE_URL=https://<temp> k6 run e2e/load/peak-morning.js
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter } from 'k6/metrics'
import { BASE, USERS, CP_NAME, login, jsonHeaders, pick } from './lib/common.js'

const serverErrors = new Counter('server_errors_5xx')

export const options = {
  scenarios: {
    peak_morning: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m', target: Number(__ENV.PEAK_VUS || 100) }, // ramp до 100 за 5 мин
        { duration: '15m', target: Number(__ENV.PEAK_VUS || 100) }, // удержание 15 мин
        { duration: '1m', target: 0 }, // плавный спад
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'], // SLO пик p95
    server_errors_5xx: ['count<1'], // 5xx = 0
    http_req_failed: ['rate<0.01'],
  },
}

const READ_ENDPOINTS = ['/api/auth/me', '/api/payment-requests', '/api/notifications']

export default function () {
  const csrf = login(USERS.user)
  const roll = Math.random()

  if (roll < 0.3 && CP_NAME) {
    // UPLOAD (30%) — presign.
    const res = http.post(
      `${BASE}/api/files/upload-url`,
      JSON.stringify({
        fileName: `peak-${__VU}-${__ITER}.pdf`,
        contentType: 'application/pdf',
        context: 'general',
        counterpartyName: CP_NAME,
      }),
      { headers: jsonHeaders(csrf), tags: { kind: 'upload' } },
    )
    if (res.status >= 500) serverErrors.add(1)
    check(res, { 'presign < 500': (r) => r.status < 500 })
  } else {
    const res = http.get(`${BASE}${pick(READ_ENDPOINTS)}`, { tags: { kind: 'read' } })
    if (res.status >= 500) serverErrors.add(1)
    check(res, { 'read < 500': (r) => r.status < 500 })
  }

  sleep(0.5 + Math.random()) // плотный пик: think-time 0.5–1.5 с
}
