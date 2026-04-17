import { lazy } from 'react'
import type { ComponentType } from 'react'
import { isChunkLoadError } from '@/utils/chunkLoadRecovery'

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Обёртка над React.lazy с повторными попытками при сетевом сбое.
 * Делает 3 попытки суммарно (1 основная + 2 повторные) с задержками 500 мс и 1500 мс.
 * Повторяет загрузку только для ошибок загрузки чанков, прочие ошибки пробрасывает сразу.
 */
export const lazyWithRetry = <T extends ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> => {
  return lazy(async () => {
    const delays = [500, 1500]
    let lastError: unknown

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await importer()
      } catch (error) {
        lastError = error
        if (!isChunkLoadError(error) || attempt === delays.length) {
          throw error
        }
        await sleep(delays[attempt])
      }
    }

    throw lastError
  })
}
