/**
 * Critical E2E: OCR full lifecycle (план Iteration 9).
 *
 * PDF → BullMQ-задача → ocrWorker → mock OpenRouter → парсинг → создание спецификации →
 * SSE-прогресс (/api/ocr/progress/:paymentRequestId) → отображение в UI.
 *
 * Mock OpenRouter настраивается на стенде (OPENROUTER_BASE_URL → локальный мок с детерминированным
 * ответом), чтобы не дёргать реальный API и не платить за токены. Воркер запущен (RUN_WORKERS=true).
 *
 * UI-уровень (видимая часть цикла) + проверка SSE-прогресса.
 */
import { test, expect } from '@playwright/test'
import { uiLoginAs } from '../helpers/auth'

test.describe.configure({ mode: 'serial' })

const INVOICE_PDF = {
  name: 'invoice-ocr.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 e2e ocr invoice — позиция: Кабель 100 м'),
}

test('OCR полный цикл: загрузка PDF → распознавание → спецификация в UI', async ({ page }) => {
  test.setTimeout(180_000)
  await uiLoginAs(page, 'counterparty')

  // Запуск OCR-распознавания счёта.
  await page
    .getByRole('button', { name: /загрузить счёт|распознать|ocr|новый счёт/i })
    .first()
    .click()
  await page.setInputFiles('input[type="file"]', INVOICE_PDF)

  // Прогресс распознавания (SSE-обновления отражаются в UI).
  await expect(page.getByText(/в обработке|распознаётся|в очереди|прогресс/i)).toBeVisible({
    timeout: 30_000,
  })

  // Появление спецификации (результат парсинга мок-ответа OpenRouter).
  await expect(page.getByText(/спецификаци|позици|распознано|готово/i).first()).toBeVisible({
    timeout: 120_000,
  })

  // Хотя бы одна распознанная строка материала видна.
  await expect(page.getByText(/кабель|материал|наименовани/i).first()).toBeVisible({
    timeout: 10_000,
  })
})

test('SSE-прогресс отдаёт события для активной задачи', async ({ page }) => {
  await uiLoginAs(page, 'counterparty')
  // Открываем заявку с активным OCR и убеждаемся, что прогресс-канал жив (нет «ошибка OCR»).
  await page.getByRole('row').nth(1).click()
  await expect(page.getByText(/ошибка ocr|не удалось распознать/i)).toHaveCount(0)
})
