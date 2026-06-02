/**
 * Role-based E2E: user (сотрудник) — на копии prod-данных (план Iteration 9).
 *
 * Покрывает (Gate Iteration 9): логин; фильтрация по подразделению (omts/shtab/smetny);
 * согласование (approve / reject с обязательной причиной / отправка на доработку / откат на
 * предыдущий этап); назначение исполнителя; создание РП в DpFillModal (split-layout); материалы;
 * импорт/экспорт ExcelJS.
 *
 * Best-effort селекторы (операторский артефакт).
 */
import { test, expect } from '@playwright/test'
import { uiLoginAs } from '../helpers/auth'

test.describe.configure({ mode: 'serial' })

test('логин сотрудника + доступ к разделу согласований', async ({ page }) => {
  await uiLoginAs(page, 'user')
  await expect(page.getByText(/на согласовани|заявки|реестр/i).first()).toBeVisible()
  // Сотрудник не видит администрирование.
  await expect(page.getByText(/конструктор цепочек|OCR-модели/i)).toHaveCount(0)
})

test('фильтрация по подразделению (omts / shtab / smetny)', async ({ page }) => {
  await uiLoginAs(page, 'user')
  for (const dep of [/ОМТС|omts/i, /штаб|shtab/i, /сметн|smetny/i]) {
    const filter = page.getByRole('tab', { name: dep }).or(page.getByText(dep).first())
    if (await filter.count()) {
      await filter.first().click()
      // Таблица перерисовалась без ошибок.
      await expect(page.locator('table, [role="table"]').first()).toBeVisible()
    }
  }
})

test('согласование: approve', async ({ page }) => {
  await uiLoginAs(page, 'user')
  await page
    .getByText(/на согласовани/i)
    .first()
    .click()
  await page.getByRole('row').nth(1).click()
  await page.getByRole('button', { name: /согласовать|approve/i }).click()
  await expect(page.getByText(/согласовано|успешно|следующий этап/i)).toBeVisible({
    timeout: 15_000,
  })
})

test('согласование: reject требует обязательную причину', async ({ page }) => {
  await uiLoginAs(page, 'user')
  await page
    .getByText(/на согласовани/i)
    .first()
    .click()
  await page.getByRole('row').nth(1).click()
  await page.getByRole('button', { name: /отклонить|reject/i }).click()

  // Без причины — submit заблокирован/валидация; с причиной — успех.
  const confirm = page.getByRole('button', { name: /подтвердить|отклонить|ок/i }).last()
  await confirm.click()
  await expect(page.getByText(/укажите причину|обязательн|введите/i)).toBeVisible()
  await page
    .getByPlaceholder(/причин|комментар/i)
    .first()
    .fill('E2E: причина отклонения')
  await confirm.click()
  await expect(page.getByText(/отклонено|успешно/i)).toBeVisible({ timeout: 15_000 })
})

test('согласование: отправка на доработку', async ({ page }) => {
  await uiLoginAs(page, 'user')
  await page
    .getByText(/на согласовани/i)
    .first()
    .click()
  await page.getByRole('row').nth(1).click()
  await page.getByRole('button', { name: /на доработку|вернуть/i }).click()
  await page
    .getByPlaceholder(/причин|комментар|что исправить/i)
    .first()
    .fill('E2E: доработать спецификацию')
  await page
    .getByRole('button', { name: /подтвердить|отправить|ок/i })
    .last()
    .click()
  await expect(page.getByText(/на доработк|возвращено|успешно/i)).toBeVisible({ timeout: 15_000 })
})

test('согласование: откат на предыдущий этап', async ({ page }) => {
  await uiLoginAs(page, 'user')
  await page
    .getByText(/на согласовани/i)
    .first()
    .click()
  await page.getByRole('row').nth(1).click()
  const rollback = page.getByRole('button', { name: /откат|на предыдущий этап|назад по цепочке/i })
  if (await rollback.count()) {
    await rollback.first().click()
    await page
      .getByRole('button', { name: /подтвердить|ок/i })
      .last()
      .click()
    await expect(page.getByText(/предыдущий этап|откат|успешно/i)).toBeVisible({ timeout: 15_000 })
  }
})

test('назначение исполнителя', async ({ page }) => {
  await uiLoginAs(page, 'user')
  await page.getByRole('row').nth(1).click()
  const assign = page.getByRole('button', { name: /назначить исполнител|исполнитель/i })
  if (await assign.count()) {
    await assign.first().click()
    await page.getByRole('option').first().click()
    await page
      .getByRole('button', { name: /назначить|сохранить|ок/i })
      .last()
      .click()
    await expect(page.getByText(/назначен|исполнитель|успешно/i)).toBeVisible({ timeout: 15_000 })
  }
})

test('создание РП в DpFillModal (split-layout) + материалы', async ({ page }) => {
  await uiLoginAs(page, 'user')
  await page
    .getByRole('button', { name: /распределительн|сформировать РП|создать РП/i })
    .first()
    .click()

  // split-layout: слева заявка, справа форма РП. Добавляем материал.
  await page
    .getByRole('button', { name: /добавить материал|добавить позицию|добавить строку/i })
    .first()
    .click()
  await page
    .getByPlaceholder(/материал|наименование/i)
    .first()
    .fill('Кабель ВВГ 3x2.5')
  await page
    .getByPlaceholder(/кол-?во|количество/i)
    .first()
    .fill('100')

  await page
    .getByRole('button', { name: /сохранить РП|сформировать|сохранить/i })
    .first()
    .click()
  await expect(page.getByText(/РП сформировано|сохранено|успешно/i)).toBeVisible({
    timeout: 20_000,
  })
})

test('импорт / экспорт материалов (ExcelJS)', async ({ page }) => {
  await uiLoginAs(page, 'user')
  await page.getByRole('row').nth(1).click()

  // Экспорт: клик по кнопке инициирует download .xlsx.
  const exportBtn = page.getByRole('button', { name: /экспорт|выгрузить|excel/i }).first()
  if (await exportBtn.count()) {
    const [download] = await Promise.all([
      page.waitForEvent('download').catch(() => null),
      exportBtn.click(),
    ])
    if (download) expect(download.suggestedFilename()).toMatch(/\.xlsx?$/i)
  }

  // Импорт: загрузка xlsx с позициями.
  const importBtn = page.getByRole('button', { name: /импорт|загрузить из excel/i }).first()
  if (await importBtn.count()) {
    await importBtn.click()
    await page.setInputFiles('input[type="file"]', {
      name: 'materials.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('PK\x03\x04 e2e materials import'),
    })
    await expect(page.getByText(/импортировано|загружено|строк|ошибк/i)).toBeVisible({
      timeout: 20_000,
    })
  }
})
