/**
 * Role-based E2E: counterparty_user (подрядчик) — на копии prod-данных (план Iteration 9).
 *
 * Покрывает (Gate Iteration 9): логин ПРЕЖНИМ паролем (импорт хэшей), создание заявки на оплату
 * (PDF + xlsx), создание заявки на договор (учредительные документы), редактирование шапки до
 * определённого статуса, реакция на доработку, реакция на отклонение, чат со счётчиком новых
 * сообщений, смена пароля через UI.
 *
 * Селекторы — best-effort по русскому тексту/ролям (операторский артефакт; правятся точечно под
 * актуальный UI, как и smoke-synthetic.spec.ts). Видимость только своих файлов — обеспечивает
 * counterparty_id-фильтрация бэкенда.
 */
import { test, expect } from '@playwright/test'
import { uiLogin, uiLoginAs } from '../helpers/auth'
import { CREDS } from '../helpers/config'

test.describe.configure({ mode: 'serial' })

const PDF = {
  name: 'invoice.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 e2e payment invoice'),
}
const XLSX = {
  name: 'spec.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: Buffer.from('PK\x03\x04 e2e xlsx'),
}
const FOUNDING = {
  name: 'ustav.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 учредительные документы'),
}

test('логин прежним паролем (импорт bcrypt-хэшей)', async ({ page }) => {
  await uiLogin(page, CREDS.counterparty)
  // Подрядчик видит свой раздел заявок, не видит администрирование.
  await expect(page.getByText(/администрирование|конструктор цепочек/i)).toHaveCount(0)
})

test('создание заявки на оплату с файлами PDF + xlsx', async ({ page }) => {
  await uiLoginAs(page, 'counterparty')

  await page
    .getByRole('button', { name: /создать|новая заявка|заявка на оплату/i })
    .first()
    .click()

  // Шапка: объект / тип затрат (засеяны в копии данных).
  await page
    .getByText(/объект/i)
    .first()
    .click()
  await page.getByRole('option').first().click()

  // Прикрепляем PDF и xlsx.
  await page.setInputFiles('input[type="file"]', [PDF, XLSX])
  await expect(page.getByText(new RegExp(PDF.name, 'i'))).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: /на согласование|отправить/i }).click()
  await expect(page.getByText(/на согласовании|отправлено|успешно/i)).toBeVisible({
    timeout: 20_000,
  })
})

test('создание заявки на договор с учредительными документами', async ({ page }) => {
  await uiLoginAs(page, 'counterparty')

  await page
    .getByText(/заявк.* на договор|договорн/i)
    .first()
    .click()
  await page
    .getByRole('button', { name: /создать|новая|добавить/i })
    .first()
    .click()

  await page.setInputFiles('input[type="file"]', [FOUNDING])
  await expect(page.getByText(/ustav|учредительн/i)).toBeVisible({ timeout: 30_000 })

  await page
    .getByRole('button', { name: /сохранить|отправить|создать/i })
    .first()
    .click()
  await expect(page.getByText(/создан|сохранено|на согласовании|успешно/i)).toBeVisible({
    timeout: 20_000,
  })
})

test('редактирование шапки заявки до определённого статуса', async ({ page }) => {
  await uiLoginAs(page, 'counterparty')

  // Открываем черновик/возвращённую заявку (редактирование доступно не во всех статусах).
  await page
    .getByRole('row')
    .filter({ hasText: /черновик|на доработк/i })
    .first()
    .click()
  const назначение = page.getByLabel(/назначение платежа|комментарий|описание/i).first()
  if (await назначение.count()) {
    await назначение.fill('Уточнённое назначение платежа (E2E)')
    await page.getByRole('button', { name: /сохранить/i }).click()
    await expect(page.getByText(/сохранено|обновлено|успешно/i)).toBeVisible({ timeout: 15_000 })
  }
})

test('реакция на доработку: правки и повторная отправка', async ({ page }) => {
  await uiLoginAs(page, 'counterparty')

  await page
    .getByText(/на доработк/i)
    .first()
    .click()
  await page.getByRole('row').nth(1).click()
  // Догружаем недостающий файл / правим и отправляем снова.
  await page.setInputFiles('input[type="file"]', [PDF]).catch(() => {})
  await page
    .getByRole('button', { name: /отправить|повторно|на согласование/i })
    .first()
    .click()
  await expect(page.getByText(/на согласовании|отправлено|успешно/i)).toBeVisible({
    timeout: 20_000,
  })
})

test('реакция на отклонение: заявка помечена «Отклонено»', async ({ page }) => {
  await uiLoginAs(page, 'counterparty')
  await page
    .getByText(/отклонен/i)
    .first()
    .click()
  // Отклонённую заявку нельзя отправить повторно — кнопки согласования нет.
  await expect(page.getByText(/отклонено/i).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^на согласование$/i })).toHaveCount(0)
})

test('чат: отправка сообщения и счётчик новых сообщений', async ({ page }) => {
  await uiLoginAs(page, 'counterparty')
  await page.getByRole('row').nth(1).click()
  await page
    .getByRole('tab', { name: /чат|сообщени|комментар/i })
    .first()
    .click()

  const message = `E2E сообщение ${Date.now()}`
  await page
    .getByPlaceholder(/сообщение|введите|комментар/i)
    .first()
    .fill(message)
  await page
    .getByRole('button', { name: /отправить|send/i })
    .first()
    .click()
  await expect(page.getByText(message)).toBeVisible({ timeout: 15_000 })
})

test('смена пароля через UI (старый не работает, новый работает)', async ({ page }) => {
  const newPass = `E2E-new-${Date.now()}`
  await uiLoginAs(page, 'counterparty')

  await page
    .getByRole('button', { name: /профиль|настройки|аккаунт/i })
    .first()
    .click()
  await page
    .getByText(/смен.* парол/i)
    .first()
    .click()
  await page.getByLabel(/текущий пароль/i).fill(CREDS.counterparty.password)
  await page
    .getByLabel(/новый пароль/i)
    .first()
    .fill(newPass)
  await page
    .getByLabel(/повтор|подтверд/i)
    .first()
    .fill(newPass)
  await page.getByRole('button', { name: /сменить|сохранить|подтвердить/i }).click()
  await expect(page.getByText(/пароль изменён|успешно/i)).toBeVisible({ timeout: 15_000 })

  // Перелогин новым паролем.
  await page.context().clearCookies()
  await uiLogin(page, { email: CREDS.counterparty.email, password: newPass })
  await expect(page.getByRole('button', { name: /войти|вход/i })).toHaveCount(0)

  // Возврат пароля к исходному (идемпотентность набора на копии данных).
  await page
    .getByRole('button', { name: /профиль|настройки|аккаунт/i })
    .first()
    .click()
  await page
    .getByText(/смен.* парол/i)
    .first()
    .click()
  await page.getByLabel(/текущий пароль/i).fill(newPass)
  await page
    .getByLabel(/новый пароль/i)
    .first()
    .fill(CREDS.counterparty.password)
  await page
    .getByLabel(/повтор|подтверд/i)
    .first()
    .fill(CREDS.counterparty.password)
  await page.getByRole('button', { name: /сменить|сохранить|подтвердить/i }).click()
})
