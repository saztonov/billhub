import { create } from 'zustand'
import { supabase } from '@/services/supabase'
import { uploadRequestFile, uploadDecisionFile } from '@/services/s3'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'

interface FileToUpload {
  file: File
  documentTypeId?: string
  pageCount?: number | null
  isResubmit?: boolean
}

export interface UploadTask {
  type: 'request_files' | 'decision_files'
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
    // Для request_files используем requestId как ключ
    const taskKey = taskData.type === 'request_files' ? task.requestId : task.decisionId!
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

            // Сохраняем метаданные файла в БД
            const { error: fileError } = await supabase
              .from('payment_request_files')
              .insert({
                payment_request_id: task.requestId,
                document_type_id: fileData.documentTypeId!,
                file_name: fileData.file.name,
                file_key: key,
                file_size: fileData.file.size,
                mime_type: fileData.file.type || null,
                page_count: fileData.pageCount ?? null,
                created_by: task.userId,
                is_resubmit: fileData.isResubmit ?? false,
              })
            if (fileError) throw fileError

            // Обновляем uploaded_files в БД
            const newUploaded = get().tasks[taskId].uploaded + 1

            // Если файл загружается при повторной отправке, увеличиваем и total_files
            if (fileData.isResubmit) {
              const { data: currentReq } = await supabase
                .from('payment_requests')
                .select('total_files')
                .eq('id', task.requestId)
                .single()

              const newTotal = (currentReq?.total_files ?? 0) + 1
              await supabase
                .from('payment_requests')
                .update({
                  uploaded_files: newUploaded,
                  total_files: newTotal,
                })
                .eq('id', task.requestId)
            } else {
              await supabase
                .from('payment_requests')
                .update({ uploaded_files: newUploaded })
                .eq('id', task.requestId)
            }

            // Обновляем прогресс в очереди
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
          }
        } else if (task.type === 'decision_files') {
          // Логика загрузки файлов решения об отклонении
          for (let i = 0; i < task.files.length; i++) {
            const fileData = task.files[i]

            // Загружаем файл на S3
            const { key } = await uploadDecisionFile(task.decisionId!, fileData.file)

            // Сохраняем метаданные в БД
            const { error: fileError } = await supabase
              .from('approval_decision_files')
              .insert({
                approval_decision_id: task.decisionId!,
                file_name: fileData.file.name,
                file_key: key,
                file_size: fileData.file.size,
                mime_type: fileData.file.type || null,
                created_by: task.userId,
              })
            if (fileError) throw fileError

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
        }

        // Успех
        set((state) => ({
          tasks: {
            ...state.tasks,
            [taskId]: { ...state.tasks[taskId], status: 'success' },
          },
        }))
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Ошибка загрузки файла'
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
