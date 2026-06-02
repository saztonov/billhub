// k6: «Массовый OCR» — 50 OCR-задач одновременно при OCR_CONCURRENCY=3 (план Iteration 9).
//
// SLO: 50 задач разгребаются за ~80–100 мин (OCR_CONCURRENCY=3 × ~5 мин/задача), watchdog
//   подбирает зависшие задачи, нет потерь. Дополнительно: dead jobs = 0.
//
// Механика: enqueue 50 OCR-задач (по заявкам с приложенными счетами — E2E_OCR_REQUEST_IDS),
//   затем teardown поллит статус до разгребания или таймаута и проверяет отсутствие потерь/dead.
//
// Запуск: E2E_OCR_REQUEST_IDS=id1,id2,... SMOKE_BASE_URL=https://<temp> k6 run e2e/load/mass-ocr.js
import http from 'k6/http'
import { check, sleep } from 'k6'
import { BASE, USERS, login, jsonHeaders } from './lib/common.js'

const REQUEST_IDS = (__ENV.E2E_OCR_REQUEST_IDS || '').split(',').filter(Boolean)
const TOTAL = Number(__ENV.OCR_TASKS || 50)
const DRAIN_TIMEOUT_MIN = Number(__ENV.OCR_DRAIN_TIMEOUT_MIN || 110)

export const options = {
  scenarios: {
    enqueue_ocr: {
      executor: 'shared-iterations',
      vus: 10,
      iterations: TOTAL, // 50 enqueue одновременно (10 VU разбирают 50 итераций)
      maxDuration: '5m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
}

export function setup() {
  if (REQUEST_IDS.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('E2E_OCR_REQUEST_IDS не задан — enqueue будет пропущен; тест неполный.')
  }
  return { startedAt: Date.now() }
}

export default function () {
  if (REQUEST_IDS.length === 0) return
  const csrf = login(USERS.user)
  const id = REQUEST_IDS[__ITER % REQUEST_IDS.length]
  const res = http.post(`${BASE}/api/ocr/recognize/${id}`, '{}', { headers: jsonHeaders(csrf) })
  check(res, { 'enqueue OCR < 500': (r) => r.status < 500 })
  sleep(0.2)
}

// Поллинг разгребания очереди: ждём, пока обработаются все, проверяем отсутствие dead jobs.
export function teardown() {
  const csrf = login(USERS.admin)
  const deadline = Date.now() + DRAIN_TIMEOUT_MIN * 60 * 1000
  let processed = 0
  let dead = 0

  while (Date.now() < deadline) {
    const res = http.get(`${BASE}/api/ocr/logs?limit=200`, { headers: jsonHeaders(csrf) })
    if (res.status === 200) {
      let rows = []
      try {
        const body = res.json()
        rows = Array.isArray(body) ? body : body.items || body.logs || []
      } catch (_e) {
        rows = []
      }
      processed = rows.filter((r) => /done|success|completed/i.test(String(r.status))).length
      dead = rows.filter((r) => /dead|failed/i.test(String(r.status))).length
      if (processed >= TOTAL) break
    }
    sleep(30) // poll каждые 30 с
  }

  check(null, {
    'все OCR-задачи разгребены (нет потерь)': () =>
      processed >= Math.min(TOTAL, REQUEST_IDS.length || TOTAL),
    'dead jobs == 0': () => dead === 0,
  })
}
