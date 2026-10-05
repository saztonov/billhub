import { create } from 'zustand'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'

/**
 * Порог этапа «УОК»: сумма счёта, строго свыше которой заявка после ОМТС уходит на УОК.
 * Читается для подсчёта этапов в прогрессе заявки, меняется админом (Настройки заявок → УОК).
 */
interface UokThresholdStoreState {
  /** Порог, ₽; null — ещё не загружен */
  amount: number | null
  isLoading: boolean
  error: string | null

  /** Загрузка порога (повторно — только с force) */
  fetchThreshold: (force?: boolean) => Promise<void>
  /** Сохранение порога (только admin); ошибка пробрасывается вызывающему */
  saveThreshold: (amount: number) => Promise<void>
}

export const useUokThresholdStore = create<UokThresholdStoreState>((set, get) => ({
  amount: null,
  isLoading: false,
  error: null,

  fetchThreshold: async (force = false) => {
    if (get().isLoading || (!force && get().amount !== null)) return
    set({ isLoading: true, error: null })
    try {
      const data = await api.get<{ amount: number }>('/api/settings/uok-threshold')
      set({ amount: data.amount, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки порога УОК'
      logError({
        errorType: 'api_error',
        errorMessage: message,
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'fetchUokThreshold' },
      })
      set({ error: message, isLoading: false })
    }
  },

  saveThreshold: async (amount) => {
    set({ error: null })
    try {
      const data = await api.put<{ amount: number }>('/api/settings/uok-threshold', { amount })
      set({ amount: data.amount })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка сохранения порога УОК'
      logError({
        errorType: 'api_error',
        errorMessage: message,
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'saveUokThreshold', amount },
      })
      set({ error: message })
      throw err
    }
  },
}))
