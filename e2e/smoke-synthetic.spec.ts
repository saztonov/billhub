import { test, expect, type Page } from '@playwright/test'

/**
 * Short-smoke на синтетике (план Iteration 8) — НЕ полный test-suite.
 *
 * Покрывает критический happy-path под всеми 4 ролями на засеянных smoke-данных
 * (server/src/cli/smoke-synthetic.ts): логин под каждой ролью, создание заявки, добавление
 * позиции, отправка на согласование, одно согласование, simple-OCR с мок-OpenRouter, СБ-флоу.
 *
 * Запуск оператором: `SMOKE_BASE_URL=https://<temp-domain> npx playwright test`.
 * Селекторы — best-effort по видимому тексту/ролям; при расхождении с актуальным UI правятся
 * точечно (это операторский артефакт, не CI-гейт).
 *
 * Креды синхронны с SMOKE_USERS / SMOKE_PASSWORD из smoke-synthetic.ts.
 */
const PASSWORD = 'Smoke-Pass-12345'
const USERS = {
  admin: 'admin@smoke.local',
  user: 'user@smoke.local',
  contractor: 'contractor@smoke.local',
  security: 'security@smoke.local',
} as const

/** Логин через форму. Возвращает на главную после успешной аутентификации. */
async function login(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel(/e-?mail/i).fill(email)
  await page.getByLabel(/пароль|password/i).fill(PASSWORD)
  await page.getByRole('button', { name: /войти|вход|sign in/i }).click()
  // После логина не должно остаться формы логина.
  await expect(page.getByRole('button', { name: /войти|вход|sign in/i })).toHaveCount(0, {
    timeout: 15_000,
  })
}

async function logout(page: Page): Promise<void> {
  // Очистка сессии между ролями (cookies httpOnly чистятся бэкендом на /logout, но для smoke —
  // достаточно сбросить storage и куки контекста).
  await page.context().clearCookies()
}

test.describe('smoke-synthetic: логин под всеми ролями', () => {
  for (const [role, email] of Object.entries(USERS)) {
    test(`логин: ${role}`, async ({ page }) => {
      await login(page, email)
      // Базовая проверка: попадаем в приложение (есть навигация/меню).
      await expect(page.locator('body')).toBeVisible()
      await logout(page)
    })
  }
})

test('counterparty_user: создание заявки на оплату + позиция + отправка на согласование', async ({
  page,
}) => {
  await login(page, USERS.contractor)

  // Переход к созданию заявки на оплату.
  await page
    .getByRole('button', { name: /создать|новая заявка|добавить/i })
    .first()
    .click()

  // Шапка заявки: выбрать объект / тип затрат (засеяны в smoke).
  await page
    .getByText(/объект/i)
    .first()
    .click()
  await page.getByText(/Объект Смоук/).click()

  // Добавить позицию спецификации.
  await page.getByRole('button', { name: /добавить позицию|добавить строку|позиция/i }).click()
  await page
    .getByPlaceholder(/наименование|материал/i)
    .first()
    .fill('Тестовый материал')
  await page
    .getByPlaceholder(/кол-?во|количество/i)
    .first()
    .fill('1')

  // Отправить на согласование.
  await page.getByRole('button', { name: /на согласование|отправить/i }).click()
  await expect(page.getByText(/на согласовании|отправлено|успешно/i)).toBeVisible({
    timeout: 15_000,
  })
  await logout(page)
})

test('user: согласование заявки', async ({ page }) => {
  await login(page, USERS.user)

  // Открыть список заявок на согласовании и согласовать первую.
  await page
    .getByText(/на согласовании|согласование/i)
    .first()
    .click()
  await page.getByRole('row').nth(1).click()
  await page.getByRole('button', { name: /согласовать|approve/i }).click()
  await expect(page.getByText(/согласовано|успешно/i)).toBeVisible({ timeout: 15_000 })
  await logout(page)
})

test('simple-OCR с мок-OpenRouter: загрузка счёта → распознавание', async ({ page }) => {
  // Мок OpenRouter настраивается на стенде (env OPENROUTER_BASE_URL → локальный mock,
  // возвращающий детерминированный ответ). Здесь проверяем сам флоу до появления спецификации.
  await login(page, USERS.contractor)
  await page
    .getByRole('button', { name: /загрузить счёт|ocr|распознать/i })
    .first()
    .click()
  await page.setInputFiles('input[type="file"]', {
    name: 'invoice.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 smoke test invoice'),
  })
  await expect(page.getByText(/распознаётся|в обработке|готово|спецификация/i)).toBeVisible({
    timeout: 30_000,
  })
  await logout(page)
})

test('security: решение СБ по поставщику', async ({ page }) => {
  await login(page, USERS.security)

  // СБ видит раздел поставщиков; выносит решение (approved/rejected) с комментарием.
  await page
    .getByText(/поставщик/i)
    .first()
    .click()
  await page.getByRole('row').nth(1).click()
  await page
    .getByRole('button', { name: /проверк|решение|согласовать|отклонить/i })
    .first()
    .click()
  await page
    .getByPlaceholder(/комментарий|причина/i)
    .first()
    .fill('Smoke СБ: проверено')
  await page.getByRole('button', { name: /подтвердить|сохранить|ок/i }).click()
  await expect(page.getByText(/проверено|approved|rejected|сохранено/i)).toBeVisible({
    timeout: 15_000,
  })
})
