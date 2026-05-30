/**
 * Базовые MSW handlers по умолчанию.
 * Сейчас пуст — конкретные тесты регистрируют свои через server.use(...).
 */
import type { HttpHandler } from 'msw'

export const handlers: HttpHandler[] = []
