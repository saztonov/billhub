import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import { uploadRequestFile } from '@/services/s3'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'

interface FileToUpload {
  file: File
  documentTypeId: string
  pageCount: number | null
}

export interface UploadTask {
  requestId: string
  requestNumber: string
  counterpartyName: string
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
  retryTask: (requestId: string) => void
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
    set((state) => ({
      tasks: { ...state.tasks, [task.requestId]: task },
    }))
    processQueue(get, set)
  },

  retryTask: (requestId) => {
    const task = get().tasks[requestId]
    if (!task || task.status !== 'error') return

    // Оставляем только незагруженные файлы (пропускаем уже загруженные)
    const remainingFiles = task.files.slice(task.uploaded)
    set((state) => ({
      tasks: {
        ...state.tasks,
        [requestId]: {
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

      const [requestId, task] = pendingEntry

      // Ставим статус uploading
      set((state) => ({
        tasks: {
          ...state.tasks,
          [requestId]: { ...state.tasks[requestId], status: 'uploading' },
        },
      }))

      try {
        for (let i = 0; i < task.files.length; i++) {
          const fileData = task.files[i]
          const { key } = await uploadRequestFile(
            task.counterpartyName,
            task.requestNumber,
            fileData.file,
          )

          // Сохраняем метаданные файла в БД
          const { error: fileError } = await supabase
            .from('payment_request_files')
            .insert({
              payment_request_id: task.requestId,
              document_type_id: fileData.documentTypeId,
              file_name: fileData.file.name,
              file_key: key,
              file_size: fileData.file.size,
              mime_type: fileData.file.type || null,
              page_count: fileData.pageCount,
              created_by: task.userId,
            })
          if (fileError) throw fileError

          // Обновляем uploaded_files в БД
          const newUploaded = get().tasks[requestId].uploaded + 1
          await supabase
            .from('payment_requests')
            .update({ uploaded_files: newUploaded })
            .eq('id', task.requestId)

          // Обновляем прогресс в очереди
          set((state) => ({
            tasks: {
              ...state.tasks,
              [requestId]: {
                ...state.tasks[requestId],
                uploaded: newUploaded,
              },
            },
          }))

          // Обновляем локальное состояние таблицы
          usePaymentRequestStore.getState().incrementUploadedFiles(task.requestId)
        }

        // Успех
        set((state) => ({
          tasks: {
            ...state.tasks,
            [requestId]: { ...state.tasks[requestId], status: 'success' },
          },
        }))
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Ошибка загрузки файла'
        set((state) => ({
          tasks: {
            ...state.tasks,
            [requestId]: {
              ...state.tasks[requestId],
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
