import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright-конфиг для short-smoke на синтетике (план Iteration 8).
 *
 * Операторский артефакт: запускается на ПОДНЯТОМ стеке (frontend + backend на временном домене
 * новой VPS, БД засеяна smoke-данными — см. server/src/cli/smoke-synthetic.ts). НЕ часть unit/CI
 * по умолчанию; @playwright/test устанавливается оператором (`npm i -D @playwright/test`).
 *
 * BASE_URL — адрес стенда (временный домен с basic-auth или http://localhost). Логины/пароли
 * синтетических пользователей совпадают с SMOKE_USERS / SMOKE_PASSWORD из smoke-synthetic.ts.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
