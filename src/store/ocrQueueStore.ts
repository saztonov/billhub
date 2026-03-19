import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import { logError } from '@/services/errorLogger'
import { processPaymentRequestOcr } from '@/services/ocrService'
import type { OcrProgress } from '@/services/ocrService'

/** Задача в очереди OCR-распознавания */
export interface OcrQueueTask {
  paymentRequestId: string
  requestNumber: string
  source: 'auto' | 'manual'
  status: 'pending' | 'processing' | 'success' | 'error'
  progress: OcrProgress | null
  errorMessage?: string
  retryCount: number
  addedAt: number
}

interface OcrQueueStoreState {
  tasks: Record<string, OcrQueueTask>

  /** Добавить заявку в очередь распознавания */
  enqueue: (paymentRequestId: string, source: 'auto' | 'manual', requestNumber?: string) => void

  /** Повторить ошибочную задачу */
  retry: (paymentRequestId: string) => void

  /** Отменить pending-задачу */
  cancel: (paymentRequestId: string) => void

  /** Очистить завершённые и ошибочные задачи */
  clearCompleted: () => void
}

// Задержка перед автоматическим retry (мс)
const AUTO_RETRY_DELAY_MS = 5000

/** Флаг, что очередь обрабатывается */
let processing = false

export const useOcrQueueStore = create<OcrQueueStoreState>((set, get) => ({
  tasks: {},

  enqueue: (paymentRequestId, source, requestNumber) => {
    const existing = get().tasks[paymentRequestId]
    // Дедупликация: игнорируем если задача уже в обработке
    if (existing && (existing.status === 'pending' || existing.status === 'processing')) {
      return
    }

    const task: OcrQueueTask = {
      paymentRequestId,
      requestNumber: requestNumber ?? '',
      source,
      status: 'pending',
      progress: null,
      retryCount: 0,
      addedAt: Date.now(),
    }

    set((state) => ({
      tasks: { ...state.tasks, [paymentRequestId]: task },
    }))

    // Подгружаем номер заявки если не передан
    if (!requestNumber) {
      loadRequestNumber(paymentRequestId, set)
    }

    processQueue(get, set)
  },

  retry: (paymentRequestId) => {
    const task = get().tasks[paymentRequestId]
    if (!task || task.status !== 'error') return

    set((state) => ({
      tasks: {
        ...state.tasks,
        [paymentRequestId]: {
          ...task,
          status: 'pending',
          errorMessage: undefined,
          progress: null,
        },
      },
    }))
    processQueue(get, set)
  },

  cancel: (paymentRequestId) => {
    const task = get().tasks[paymentRequestId]
    if (!task || task.status !== 'pending') return

    const { [paymentRequestId]: _removed, ...rest } = get().tasks
    void _removed
    set({ tasks: rest })
  },

  clearCompleted: () => {
    const tasks = get().tasks
    const filtered: Record<string, OcrQueueTask> = {}
    for (const [id, task] of Object.entries(tasks)) {
      if (task.status === 'pending' || task.status === 'processing') {
        filtered[id] = task
      }
    }
    set({ tasks: filtered })
  },
}))

/** Подгружает номер заявки из БД для отображения */
async function loadRequestNumber(
  paymentRequestId: string,
  set: (fn: (state: OcrQueueStoreState) => Partial<OcrQueueStoreState>) => void,
) {
  try {
    const { data } = await supabase
      .from('payment_requests')
      .select('request_number')
      .eq('id', paymentRequestId)
      .single()

    if (data) {
      set((state) => {
        const task = state.tasks[paymentRequestId]
        if (!task) return state
        return {
          tasks: {
            ...state.tasks,
            [paymentRequestId]: {
              ...task,
              requestNumber: (data as Record<string, unknown>).request_number as string,
            },
          },
        }
      })
    }
  } catch {
    // Некритичная ошибка — номер заявки просто не отобразится
  }
}

/** Выбирает следующую pending-задачу (manual приоритетнее auto) */
function pickNextTask(tasks: Record<string, OcrQueueTask>): [string, OcrQueueTask] | null {
  const pending = Object.entries(tasks).filter(([, t]) => t.status === 'pending')
  if (pending.length === 0) return null

  // Сначала manual, потом auto, внутри каждой группы — по времени добавления
  pending.sort(([, a], [, b]) => {
    if (a.source !== b.source) {
      return a.source === 'manual' ? -1 : 1
    }
    return a.addedAt - b.addedAt
  })

  return pending[0]
}

/** Обработка очереди — берёт задачи по одной и выполняет */
async function processQueue(
  get: () => OcrQueueStoreState,
  set: (fn: (state: OcrQueueStoreState) => Partial<OcrQueueStoreState>) => void,
) {
  if (processing) return
  processing = true

  try {
    while (true) {
      const next = pickNextTask(get().tasks)
      if (!next) break

      const [taskId, task] = next

      // Ставим статус processing
      set((state) => ({
        tasks: {
          ...state.tasks,
          [taskId]: { ...state.tasks[taskId], status: 'processing', progress: null },
        },
      }))

      try {
        await processPaymentRequestOcr(taskId, (progress) => {
          // Обновляем прогресс в стейте
          set((state) => {
            const current = state.tasks[taskId]
            if (!current) return state
            return {
              tasks: {
                ...state.tasks,
                [taskId]: { ...current, progress },
              },
            }
          })
        })

        // Успех
        set((state) => ({
          tasks: {
            ...state.tasks,
            [taskId]: { ...state.tasks[taskId], status: 'success', progress: null },
          },
        }))
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Неизвестная ошибка OCR'
        const currentTask = get().tasks[taskId]

        logError({
          errorType: 'api_error',
          errorMessage: `OCR очередь: ошибка для заявки ${task.requestNumber || taskId}: ${errorMessage}`,
          component: 'ocrQueueStore',
        })

        if (currentTask && currentTask.retryCount < 1) {
          // Автоматический retry: ставим pending с увеличенным retryCount
          set((state) => ({
            tasks: {
              ...state.tasks,
              [taskId]: {
                ...state.tasks[taskId],
                status: 'pending',
                retryCount: currentTask.retryCount + 1,
                progress: null,
              },
            },
          }))

          // Задержка перед retry
          await new Promise((r) => setTimeout(r, AUTO_RETRY_DELAY_MS))
        } else {
          // Лимит попыток исчерпан — ставим error
          set((state) => ({
            tasks: {
              ...state.tasks,
              [taskId]: {
                ...state.tasks[taskId],
                status: 'error',
                errorMessage,
                progress: null,
              },
            },
          }))
        }
      }
    }
  } finally {
    processing = false
  }
}
