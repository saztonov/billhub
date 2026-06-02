/**
 * Общая конфигурация role-based / critical / security E2E (план Iteration 9).
 *
 * Тесты идут на ПОДНЯТОМ стенде новой VPS, наполненном КОПИЕЙ prod-данных (dump-and-restore.sh),
 * на временном домене с basic-auth + IP-allowlist (среда с реальными ПДн — доступ только команде).
 *
 * Креды берутся из окружения (реальные пользователи из копии prod-данных). Для smoke-стенда
 * можно переиспользовать синтетических пользователей smoke-synthetic.ts (значения по умолчанию).
 * Пароли — прежние (импортированы import-passwords.ts), что и проверяет логин «прежним паролем».
 */

export interface RoleCreds {
  email: string
  password: string
}

/** Учётки по ролям. ENV переопределяет дефолты (синтетика smoke-стенда). */
export const CREDS = {
  admin: {
    email: process.env.E2E_ADMIN_EMAIL ?? 'admin@smoke.local',
    password: process.env.E2E_ADMIN_PASSWORD ?? 'Smoke-Pass-12345',
  },
  user: {
    email: process.env.E2E_USER_EMAIL ?? 'user@smoke.local',
    password: process.env.E2E_USER_PASSWORD ?? 'Smoke-Pass-12345',
  },
  counterparty: {
    email: process.env.E2E_CP_EMAIL ?? 'contractor@smoke.local',
    password: process.env.E2E_CP_PASSWORD ?? 'Smoke-Pass-12345',
  },
  security: {
    email: process.env.E2E_SECURITY_EMAIL ?? 'security@smoke.local',
    password: process.env.E2E_SECURITY_PASSWORD ?? 'Smoke-Pass-12345',
  },
} satisfies Record<string, RoleCreds>

/** Базовый URL стенда (временный домен новой VPS либо localhost). */
export const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:5173'

/** Префикс API (фронтенд проксирует /api/* на Fastify). */
export const API = `${BASE_URL.replace(/\/$/, '')}`
