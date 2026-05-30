/**
 * MSW server для перехвата HTTP-запросов в фронт-тестах.
 * Базовые обработчики /api/* можно регистрировать в src/test/handlers.ts;
 * конкретные тесты добавляют свои через server.use(...).
 */
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
