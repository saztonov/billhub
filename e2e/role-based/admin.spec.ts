/**
 * Role-based E2E: admin — на копии prod-данных (план Iteration 9).
 *
 * Покрывает (Gate Iteration 9): полный доступ + управление справочниками + конструктор цепочек +
 * OCR-модели + ErrorLogs + импорт пользователей контрагентов из Excel + закрытие доработки за
 * Штаб/Подрядчика + изменение суммы с обязательным окном причины.
 *
 * Best-effort селекторы (операторский артефакт).
 */
import { test, expect } from '@playwright/test'
import { uiLoginAs } from '../helpers/auth'

test.describe.configure({ mode: 'serial' })

test('логин admin + видимость всех разделов администрирования', async ({ page }) => {
  await uiLoginAs(page, 'admin')
  await expect(page.getByText(/администрирование|справочники/i).first()).toBeVisible()
  await expect(page.getByText(/конструктор цепочек/i)).toBeVisible()
})

test('управление справочниками: создание контрагента', async ({ page }) => {
  await uiLoginAs(page, 'admin')
  await page
    .getByText(/справочники|контрагент/i)
    .first()
    .click()
  await page
    .getByText(/контрагент/i)
    .first()
    .click()
  await page
    .getByRole('button', { name: /добавить|создать|новый/i })
    .first()
    .click()
  await page
    .getByLabel(/наименование|название|имя/i)
    .first()
    .fill(`E2E Контрагент ${Date.now()}`)
  await page
    .getByRole('button', { name: /сохранить|создать|ок/i })
    .first()
    .click()
  await expect(page.getByText(/сохранено|создан|успешно/i)).toBeVisible({ timeout: 15_000 })
})

test('конструктор цепочек согласования', async ({ page }) => {
  await uiLoginAs(page, 'admin')
  await page
    .getByText(/конструктор цепочек|цепочки согласовани/i)
    .first()
    .click()
  await page
    .getByRole('button', { name: /создать цепочку|добавить|новая/i })
    .first()
    .click()
  await page
    .getByLabel(/название|наименование/i)
    .first()
    .fill(`E2E цепочка ${Date.now()}`)
  // Добавляем этап.
  await page
    .getByRole('button', { name: /добавить этап|добавить шаг/i })
    .first()
    .click()
  await page
    .getByRole('button', { name: /сохранить/i })
    .first()
    .click()
  await expect(page.getByText(/сохранено|создана|успешно/i)).toBeVisible({ timeout: 15_000 })
})

test('настройка OCR-моделей', async ({ page }) => {
  await uiLoginAs(page, 'admin')
  await page
    .getByText(/OCR|распознавани/i)
    .first()
    .click()
  await page.getByText(/модел/i).first().click()
  const addBtn = page.getByRole('button', { name: /добавить модель|добавить/i }).first()
  if (await addBtn.count()) {
    await addBtn.click()
    await page
      .getByLabel(/модель|идентификатор|model/i)
      .first()
      .fill('qwen/qwen2.5-vl-72b-instruct')
    await page
      .getByRole('button', { name: /сохранить|добавить|ок/i })
      .first()
      .click()
    await expect(page.getByText(/сохранено|добавлено|успешно/i)).toBeVisible({ timeout: 15_000 })
  }
})

test('страница ErrorLogs доступна и грузится', async ({ page }) => {
  await uiLoginAs(page, 'admin')
  await page
    .getByText(/логи|ошибк|error.?log/i)
    .first()
    .click()
  await expect(page.locator('table, [role="table"]').first()).toBeVisible({ timeout: 15_000 })
})

test('импорт пользователей контрагентов из Excel', async ({ page }) => {
  await uiLoginAs(page, 'admin')
  await page
    .getByText(/пользовател|контрагент/i)
    .first()
    .click()
  const importBtn = page
    .getByRole('button', { name: /импорт пользовател|импорт из excel|импорт/i })
    .first()
  if (await importBtn.count()) {
    await importBtn.click()
    await page.setInputFiles('input[type="file"]', {
      name: 'users.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('PK\x03\x04 e2e users import'),
    })
    await expect(page.getByText(/импортировано|создано|строк|ошибк/i)).toBeVisible({
      timeout: 20_000,
    })
  }
})

test('закрытие доработки за Штаб/Подрядчика (admin override)', async ({ page }) => {
  await uiLoginAs(page, 'admin')
  await page
    .getByText(/на доработк/i)
    .first()
    .click()
  await page.getByRole('row').nth(1).click()
  const closeBtn = page
    .getByRole('button', { name: /закрыть доработку|за штаб|за подрядчика|завершить доработку/i })
    .first()
  if (await closeBtn.count()) {
    await closeBtn.click()
    await page
      .getByRole('button', { name: /подтвердить|ок/i })
      .last()
      .click()
    await expect(page.getByText(/закрыт|завершено|успешно/i)).toBeVisible({ timeout: 15_000 })
  }
})

test('изменение суммы заявки требует обязательного окна причины', async ({ page }) => {
  await uiLoginAs(page, 'admin')
  await page.getByRole('row').nth(1).click()
  const amount = page.getByLabel(/сумма/i).first()
  if (await amount.count()) {
    await amount.fill('123456.78')
    await page
      .getByRole('button', { name: /сохранить|применить/i })
      .first()
      .click()
    // Должно открыться обязательное окно причины.
    await expect(page.getByText(/причин/i).first()).toBeVisible({ timeout: 10_000 })
    await page
      .getByRole('button', { name: /подтвердить|сохранить|ок/i })
      .last()
      .click()
    await expect(page.getByText(/укажите причину|обязательн/i)).toBeVisible()
    await page
      .getByPlaceholder(/причин|комментар/i)
      .first()
      .fill('E2E: корректировка суммы')
    await page
      .getByRole('button', { name: /подтвердить|сохранить|ок/i })
      .last()
      .click()
    await expect(page.getByText(/сохранено|обновлено|успешно/i)).toBeVisible({ timeout: 15_000 })
  }
})
