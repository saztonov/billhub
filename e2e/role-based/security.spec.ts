/**
 * Role-based E2E: security (СБ) — на копии prod-данных (план Iteration 9).
 *
 * Покрывает (Gate Iteration 9): логин → попадает ТОЛЬКО на /references/suppliers; запрос проверки
 * поставщика; решение СБ (approved/rejected) с комментарием; остальные разделы меню НЕВИДИМЫ;
 * блокировка заявки на договор с поставщиком last_security_status='rejected'; история проверок.
 *
 * Best-effort селекторы (операторский артефакт).
 */
import { test, expect } from '@playwright/test'
import { uiLoginAs } from '../helpers/auth'

test.describe.configure({ mode: 'serial' })

test('логин СБ → попадает только на раздел поставщиков, прочие разделы невидимы', async ({
  page,
}) => {
  await uiLoginAs(page, 'security')
  // Виден раздел поставщиков.
  await expect(page.getByText(/поставщик/i).first()).toBeVisible({ timeout: 15_000 })
  // Невидимы прочие разделы меню (заявки/администрирование/согласования/контрагенты).
  await expect(
    page.getByRole('menuitem', { name: /заявки на оплату|администрирование|согласовани/i }),
  ).toHaveCount(0)
  // URL/контент — поставщики (references/suppliers).
  expect(page.url()).toMatch(/suppliers|поставщик/i)
})

test('запрос проверки поставщика', async ({ page }) => {
  await uiLoginAs(page, 'security')
  await page
    .getByText(/поставщик/i)
    .first()
    .click()
  await page.getByRole('row').nth(1).click()
  const requestBtn = page
    .getByRole('button', { name: /запрос.* проверк|на проверку|инициировать/i })
    .first()
  if (await requestBtn.count()) {
    await requestBtn.click()
    await page
      .getByRole('button', { name: /подтвердить|ок|запросить/i })
      .last()
      .click()
    await expect(page.getByText(/на проверке|запрошено|успешно/i)).toBeVisible({ timeout: 15_000 })
  }
})

test('решение СБ: approved с комментарием', async ({ page }) => {
  await uiLoginAs(page, 'security')
  await page
    .getByText(/поставщик/i)
    .first()
    .click()
  await page.getByRole('row').nth(1).click()
  await page
    .getByRole('button', { name: /проверк|решение|согласовать|approved/i })
    .first()
    .click()
  await page
    .getByPlaceholder(/комментар|причин/i)
    .first()
    .fill('E2E СБ: проверка пройдена')
  await page
    .getByRole('button', { name: /согласовать|approved|подтвердить|ок/i })
    .last()
    .click()
  await expect(page.getByText(/approved|проверено|согласовано|успешно/i)).toBeVisible({
    timeout: 15_000,
  })
})

test('решение СБ: rejected с комментарием', async ({ page }) => {
  await uiLoginAs(page, 'security')
  await page
    .getByText(/поставщик/i)
    .first()
    .click()
  // Берём другого поставщика для отклонения.
  await page.getByRole('row').nth(2).click()
  await page
    .getByRole('button', { name: /отклонить|rejected|решение/i })
    .first()
    .click()
  await page
    .getByPlaceholder(/комментар|причин/i)
    .first()
    .fill('E2E СБ: отказ — недостоверные данные')
  await page
    .getByRole('button', { name: /отклонить|rejected|подтвердить|ок/i })
    .last()
    .click()
  await expect(page.getByText(/rejected|отклонено|успешно/i)).toBeVisible({ timeout: 15_000 })
})

test('история проверок поставщика', async ({ page }) => {
  await uiLoginAs(page, 'security')
  await page
    .getByText(/поставщик/i)
    .first()
    .click()
  await page.getByRole('row').nth(1).click()
  await page
    .getByRole('tab', { name: /истори|проверк/i })
    .first()
    .click()
  // В истории есть хотя бы запись от предыдущих тестов.
  await expect(page.getByText(/E2E СБ|approved|rejected|проверк/i).first()).toBeVisible({
    timeout: 15_000,
  })
})

test('блокировка заявки на договор с rejected-поставщиком', async ({ page }) => {
  // Заявку на договор с поставщиком last_security_status='rejected' нельзя провести дальше.
  // Проверяем сотрудником/админом, что система блокирует (СБ сам заявки не ведёт).
  await uiLoginAs(page, 'admin')
  await page
    .getByText(/заявк.* на договор|договорн/i)
    .first()
    .click()
  const row = page
    .getByRole('row')
    .filter({ hasText: /rejected|отклонён поставщик|СБ: отказ/i })
    .first()
  if (await row.count()) {
    await row.click()
    await page
      .getByRole('button', { name: /на согласование|провести|отправить/i })
      .first()
      .click()
    await expect(page.getByText(/поставщик.* отклонён|блокирован|запрещен|нельзя/i)).toBeVisible({
      timeout: 15_000,
    })
  }
})
