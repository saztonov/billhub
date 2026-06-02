// Общий модуль для k6-нагрузочных сценариев BillHub (план Iteration 9).
//
// Логин (CSRF double-submit + /api/auth/login), хранение cookie в k6 cookie-jar, генерация тел
// загрузки. Креды и BASE — из окружения (по умолчанию синтетика smoke-стенда).
//
// ВНИМАНИЕ: SLO в сценариях скорректированы под 2 CPU / 4 GB новой VPS (docker-compose.production.yml:
// API и worker делят 2 vCPU). Пороги — в thresholds каждого сценария.
import http from 'k6/http'
import { check } from 'k6'

export const BASE = __ENV.SMOKE_BASE_URL || 'http://localhost:5173'

export const USERS = {
  admin: {
    email: __ENV.E2E_ADMIN_EMAIL || 'admin@smoke.local',
    password: __ENV.E2E_ADMIN_PASSWORD || 'Smoke-Pass-12345',
  },
  user: {
    email: __ENV.E2E_USER_EMAIL || 'user@smoke.local',
    password: __ENV.E2E_USER_PASSWORD || 'Smoke-Pass-12345',
  },
  counterparty: {
    email: __ENV.E2E_CP_EMAIL || 'contractor@smoke.local',
    password: __ENV.E2E_CP_PASSWORD || 'Smoke-Pass-12345',
  },
}

export const CP_NAME = __ENV.E2E_CP_NAME || ''

/** GET /api/auth/csrf → токен (значение совпадает с cookie csrf_token). */
export function getCsrf() {
  const res = http.get(`${BASE}/api/auth/csrf`)
  try {
    return res.json('csrfToken')
  } catch (_e) {
    return null
  }
}

/** Логин: CSRF + POST /api/auth/login. Cookie сохраняются в jar VU. Возвращает csrf. */
export function login(creds) {
  const csrf = getCsrf()
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify(creds), {
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
  })
  check(res, { 'login 200': (r) => r.status === 200 })
  return csrf
}

/** Заголовки write-запроса (JSON + CSRF). */
export function jsonHeaders(csrf) {
  return { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }
}

/** Псевдослучайный размер файла в байтах в диапазоне [minMb, maxMb]. */
export function randomFileSize(minMb, maxMb) {
  const mb = minMb + Math.random() * (maxMb - minMb)
  return Math.floor(mb * 1024 * 1024)
}

/** Случайный элемент массива. */
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}
