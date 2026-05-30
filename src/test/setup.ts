/**
 * Глобальный setup для Vitest на фронтенде.
 * Подключает matchers @testing-library/jest-dom и стартует MSW server (если используется в тесте).
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, afterAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './msw-server'

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
})

afterAll(() => {
  server.close()
})
