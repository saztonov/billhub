import { create } from 'zustand'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import { uploadRequestFile, uploadDecisionFile } from '@/services/s3'
import { notifyNewFile } from '@/utils/notificationService'
import { notifyContractNewFile } from '@/utils/contractNotificationService'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import { useContractRequestStore } from '@/store/contractRequestStore'

interface FileToUpload {
  file: File
  documentTypeId?: string
  pageCount?: number | null
  isResubmit?: boolean
  isAdditional?: boolean
}

export interface UploadTask {
  type: 'request_files' | 'decision_files' | 'contract_files'
  requestId: string
  requestNumber: string
  counterpartyName?: string
  decisionId?: string
  files: FileToUpload[]
  userId: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  uploaded: number
  total: number
  errorMessage?: string
}

interface UploadQueueStoreState {
  tasks: Record<string, UploadTask>
  addTask: (task: Omit<UploadTask, 'status' | 'uploaded' | 'total'>) => void
  addDecisionFilesTask: (
    decisionId: string,
    requestNumber: string,
    files: File[],
    userId: string,
  ) => void
  retryTask: (taskId: string) => void
}

/** Флаг, что очередь обрабатывается */
let processing = false

export const useUploadQueueStore = create<UploadQueueStoreState>((set, get) => ({
  tasks: {},

  addTask: (taskData) => {
    const task: UploadTask = {
      ...taskData,
      status: 'pending',
      uploaded: 0,
      total: taskData.files.length,
    }
    // Для request_files и contract_files используем requestId как ключ
    const taskKey = taskData.type === 'decision_files' ? task.decisionId! : task.requestId
    set((state) => ({
      tasks: { ...state.tasks, [taskKey]: task },
    }))
    processQueue(get, set)
  },

  addDecisionFilesTask: (decisionId, requestNumber, files, userId) => {
    const task: UploadTask = {
      type: 'decision_files',
      requestId: '', // Не используется для decision_files
      requestNumber,
      decisionId,
      files: files.map((f) => ({ file: f })),
      userId,
      status: 'pending',
      uploaded: 0,
      total: files.length,
    }
    set((state) => ({
      tasks: { ...state.tasks, [decisionId]: task },
    }))
    processQueue(get, set)
  },

  retryTask: (taskId) => {
    const task = get().tasks[taskId]
    if (!task || task.status !== 'error') return

    // Оставляем только незагруженные файлы (пропускаем уже загруженные)
    const remainingFiles = task.files.slice(task.uploaded)
    set((state) => ({
      tasks: {
        ...state.tasks,
        [taskId]: {
          ...task,
          files: remainingFiles,
          total: task.total,
          status: 'pending',
          errorMessage: undefined,
        },
      },
    }))
    processQueue(get, set)
  },
}))

/** Обработка очереди — берёт первую pending задачу и выполняет */
async function processQueue(
  get: () => UploadQueueStoreState,
  set: (fn: (state: UploadQueueStoreState) => Partial<UploadQueueStoreState>) => void,
) {
  if (processing) return
  processing = true

  try {
    while (true) {
      const tasks = get().tasks
      const pendingEntry = Object.entries(tasks).find(([, t]) => t.status === 'pending')
      if (!pendingEntry) break

      const [taskId, task] = pendingEntry

      // Ставим статус uploading
      set((state) => ({
        tasks: {
          ...state.tasks,
          [taskId]: { ...state.tasks[taskId], status: 'uploading' },
        },
      }))

      try {
        if (task.type === 'request_files') {
          // Логика загрузки файлов заявки
          for (let i = 0; i < task.files.length; i++) {
            const fileData = task.files[i]
            const { key } = await uploadRequestFile(
              task.counterpartyName!,
              task.requestNumber,
              fileData.file,
            )

            // Сохраняем метаданные файла через API
            await api.post(`/api/payment-requests/${task.requestId}/files`, {
              documentTypeId: fileData.documentTypeId!,
              fileName: fileData.file.name,
              fileKey: key,
              fileSize: fileData.file.size,
              mimeType: fileData.file.type || null,
              pageCount: fileData.pageCount ?? null,
              userId: task.userId,
              isResubmit: fileData.isResubmit ?? false,
              isAdditional: fileData.isAdditional ?? false,
            })

            // Обновляем прогресс в очереди
            const newUploaded = get().tasks[taskId].uploaded + 1
            set((state) => ({
              tasks: {
                ...state.tasks,
                [taskId]: {
                  ...state.tasks[taskId],
                  uploaded: newUploaded,
                },
              },
            }))

            // Обновляем локальное состояние таблицы
            usePaymentRequestStore.getState().incrementUploadedFiles(task.requestId, fileData.isResubmit)

            // Обновляем список файлов в ViewRequestModal
            usePaymentRequestStore.getState().fetchRequestFiles(task.requestId)
          }
        } else if (task.type === 'decision_files') {
          // Логика загрузки файлов решения об отклонении
          for (let i = 0; i < task.files.length; i++) {
            const fileData = task.files[i]

            // Загружаем файл на S3
            const { key } = await uploadDecisionFile(task.decisionId!, fileData.file)

            // Сохраняем метаданные через API
            await api.post(`/api/approvals/decisions/${task.decisionId}/files`, {
              fileName: fileData.file.name,
              fileKey: key,
              fileSize: fileData.file.size,
              mimeType: fileData.file.type || null,
              userId: task.userId,
            })

            // Обновляем прогресс в очереди
            const newUploaded = get().tasks[taskId].uploaded + 1
            set((state) => ({
              tasks: {
                ...state.tasks,
                [taskId]: {
                  ...state.tasks[taskId],
                  uploaded: newUploaded,
                },
              },
            }))
          }
        } else if (task.type === 'contract_files') {
          // Логика загрузки файлов заявки на договор
          for (let i = 0; i < task.files.length; i++) {
            const fileData = task.files[i]

            // Загружаем файл на S3 (аналогично request_files)
            const { key } = await uploadRequestFile(
              task.counterpartyName!,
              task.requestNumber,
              fileData.file,
            )

            // Сохраняем метаданные файла через API
            await api.post(`/api/contract-requests/${task.requestId}/files`, {
              fileName: fileData.file.name,
              fileKey: key,
              fileSize: fileData.file.size,
              mimeType: fileData.file.type || null,
              userId: task.userId,
              isAdditional: fileData.isAdditional ?? false,
            })

            // Обновляем прогресс в очереди
            const newUploaded = get().tasks[taskId].uploaded + 1
            set((state) => ({
              tasks: {
                ...state.tasks,
                [taskId]: {
                  ...state.tasks[taskId],
                  uploaded: newUploaded,
                },
              },
            }))
          }

          // Обновляем список файлов в модалке договора
          useContractRequestStore.getState().fetchRequestFiles(task.requestId)
        }

        // Успех
        set((state) => ({
          tasks: {
            ...state.tasks,
            [taskId]: { ...state.tasks[taskId], status: 'success' },
          },
        }))

        // Уведомляем о новых файлах (только для файлов заявок, не для файлов решений)
        if (task.type === 'request_files') {
          notifyNewFile(task.requestId, task.userId).catch(() => {})
        } else if (task.type === 'contract_files') {
          notifyContractNewFile(task.requestId, task.userId).catch(() => {})
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Ошибка загрузки файла'
        logError({ errorType: 'api_error', errorMessage, errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'uploadFile', taskId } })
        set((state) => ({
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              status: 'error',
              errorMessage,
            },
          },
        }))
      }
    }
  } finally {
    processing = false
  }
}
