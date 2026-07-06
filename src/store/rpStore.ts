import { create } from 'zustand'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import type { RpLetter, RpDocumentsResult, RpDocumentRef, RpFilesResult } from '@/types'

/** Блок письма PayHub при создании РП (редактируемые поля формы). */
export interface RpLetterFormBlock {
  subject: string
  content: string
  responsiblePersonName: string | null
  /** true — файлы будут догружены отдельно, задача синхронизации ставится после finalize */
  hasAttachments: boolean
}

/** Вход создания РП. */
export interface CreateRpPayload {
  supplierId: string
  counterpartyId: string
  siteId: string
  paymentRequestIds: string[]
  documents: RpDocumentRef[]
  letterDate?: string | null
  /** Номер счёта (ручной ввод; хранится в rp_letters, в PayHub не уходит). */
  invoiceNumber?: string | null
  letter?: RpLetterFormBlock
}

/** Файл-счёт заявки — кандидат для прикрепления к РП. */
export interface RpInvoiceCandidateFile {
  id: string
  fileName: string
  mimeType: string | null
  sizeBytes: number | null
}

/** Группа кандидатов по заявке для окна выбора счетов. */
export interface RpInvoiceCandidateGroup {
  requestId: string
  requestNumber: string
  files: RpInvoiceCandidateFile[]
}

/** Ссылка на файл письма, загруженный в billhub S3 (контекст rp_letter). */
export interface RpLetterAttachmentRef {
  fileKey: string
  fileName: string
  mimeType?: string | null
  sizeBytes?: number | null
  /** 'rp' — скан чистовика (в поле «РП» заявок); 'other' (по умолчанию) — прочие. */
  fileType?: 'rp' | 'other'
}

/** Ссылка на служебный файл РП (billhub S3, контекст rp_service). */
export interface RpServiceFileRef {
  fileKey: string
  fileName: string
  mimeType?: string | null
  sizeBytes?: number | null
}

/** Текстовые поля письма (для finalize со 2 этапа и правки из реестра). */
export interface RpLetterTextBlock {
  letterDate?: string | null
  subject: string
  content: string
  responsiblePersonName: string | null
}

/** Ответ 1 этапа: sync — письмо создано (рег.номер + QR); async — конфигурация не готова. */
export type RpStage1Response =
  | {
      mode: 'sync'
      rp: RpLetter
      regNumber: string | null
      url: string | null
      qrSvgDataUrl: string | null
    }
  | { mode: 'async'; rp: RpLetter; reason: string }

interface RpStoreState {
  letters: RpLetter[]
  lettersLoading: boolean
  documents: RpDocumentsResult | null
  documentsLoading: boolean

  /** Загрузить реестр РП. silent — обновить данные без табличного loading (для авто-опроса). */
  loadRegistry: (opts?: { silent?: boolean }) => Promise<void>
  loadDocuments: (supplierId: string, counterpartyId: string, siteId: string) => Promise<void>
  clearDocuments: () => void
  createLetter: (payload: CreateRpPayload) => Promise<RpLetter | null>
  /** 1 этап: создать РП и синхронно письмо PayHub (рег.номер + QR) либо async-fallback. */
  createLetterStage1: (payload: CreateRpPayload) => Promise<RpStage1Response | null>
  updateStatus: (id: string, status: string) => Promise<boolean>
  /** Регистрация загруженных файлов письма за РП. */
  registerLetterAttachments: (rpLetterId: string, refs: RpLetterAttachmentRef[]) => Promise<void>
  /** Поставить синхронизацию письма в очередь (finalize; опц. актуальный текст со 2 этапа). */
  finalizeLetter: (rpLetterId: string, letter?: RpLetterTextBlock) => Promise<boolean>
  /** Удалить РП (и письмо в PayHub). Бросает ошибку при неудаче удаления письма. */
  deleteRp: (id: string) => Promise<void>
  /** Аннулировать РП (удалить письмо в PayHub). Бросает ошибку при неудаче. */
  annulRp: (id: string) => Promise<void>
  /** Правка текста письма из реестра (PATCH письма в PayHub). Бросает ошибку при неудаче. */
  editLetterText: (id: string, letter: RpLetterTextBlock) => Promise<void>
  /** Файлы РП (вложения письма PayHub + служебные) для модалки «Файлы». */
  loadRpFiles: (id: string) => Promise<RpFilesResult>
  /** Регистрация загруженных служебных файлов РП. */
  registerServiceFiles: (id: string, refs: RpServiceFileRef[]) => Promise<void>
  /** Удалить служебный файл РП. */
  deleteServiceFile: (id: string, fileId: string) => Promise<void>
  /** Активные счета выбранных заявок (для окна «+ Файл»), сгруппированные по заявке. */
  loadInvoiceCandidates: (paymentRequestIds: string[]) => Promise<RpInvoiceCandidateGroup[]>
  /** Прикрепить счета заявок к РП как служебные файлы. Возвращает число добавленных. */
  attachInvoiceServiceFiles: (rpLetterId: string, fileIds: string[]) => Promise<number>
}

/** Обновляет счётчик файлов конкретной РП в реестре (delta может быть отрицательной). */
function bumpFilesCount(letters: RpLetter[], id: string, delta: number): RpLetter[] {
  return letters.map((l) =>
    l.id === id ? { ...l, filesCount: Math.max(0, l.filesCount + delta) } : l,
  )
}

export const useRpStore = create<RpStoreState>((set, get) => ({
  letters: [],
  lettersLoading: false,
  documents: null,
  documentsLoading: false,

  loadRegistry: async (opts) => {
    const silent = opts?.silent === true
    if (!silent) set({ lettersLoading: true })
    try {
      const data = await api.get<RpLetter[]>('/api/rp')
      set({ letters: data ?? [] })
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка загрузки реестра РП',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'loadRegistry' },
      })
    } finally {
      if (!silent) set({ lettersLoading: false })
    }
  },

  loadDocuments: async (supplierId, counterpartyId, siteId) => {
    set({ documentsLoading: true, documents: null })
    try {
      const params = new URLSearchParams({ supplierId, counterpartyId, siteId })
      const data = await api.get<RpDocumentsResult>(`/api/rp/documents?${params.toString()}`)
      set({ documents: data ?? { contract: [], founding: [] } })
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка загрузки документов РП',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'loadDocuments' },
      })
      set({ documents: { contract: [], founding: [] } })
    } finally {
      set({ documentsLoading: false })
    }
  },

  clearDocuments: () => set({ documents: null }),

  createLetter: async (payload) => {
    try {
      const letter = await api.post<RpLetter>('/api/rp', payload)
      if (letter) set({ letters: [letter, ...get().letters] })
      return letter ?? null
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка создания РП',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'createLetter' },
      })
      throw err
    }
  },

  createLetterStage1: async (payload) => {
    try {
      const res = await api.post<RpStage1Response>('/api/rp/letter-stage1', payload)
      if (res?.rp) set({ letters: [res.rp, ...get().letters] })
      return res ?? null
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка создания письма (1 этап)',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'createLetterStage1' },
      })
      throw err
    }
  },

  deleteRp: async (id) => {
    try {
      await api.delete(`/api/rp/${id}`)
      set({ letters: get().letters.filter((l) => l.id !== id) })
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка удаления РП',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'deleteRp', id },
      })
      throw err
    }
  },

  annulRp: async (id) => {
    try {
      await api.post(`/api/rp/${id}/annul`)
      set({
        letters: get().letters.map((l) =>
          l.id === id
            ? {
                ...l,
                status: 'annulled',
                payhubLetterId: null,
                payhubLetterRegNumber: null,
                payhubLetterUrl: null,
                payhubLetterStatus: null,
                payhubLetterError: null,
                payhubLetterPayload: null,
              }
            : l,
        ),
      })
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка аннулирования РП',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'annulRp', id },
      })
      throw err
    }
  },

  editLetterText: async (id, letter) => {
    try {
      await api.patch(`/api/rp/${id}/letter-text`, letter)
      set({
        letters: get().letters.map((l) =>
          l.id === id
            ? {
                ...l,
                letterDate: letter.letterDate ?? null,
                payhubLetterPayload: {
                  subject: letter.subject,
                  content: letter.content,
                  responsiblePersonName: letter.responsiblePersonName,
                },
              }
            : l,
        ),
      })
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка редактирования письма',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'editLetterText', id },
      })
      throw err
    }
  },

  registerLetterAttachments: async (rpLetterId, refs) => {
    try {
      await api.post(`/api/rp/${rpLetterId}/letter/attachments`, { attachments: refs })
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка регистрации файлов письма',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'registerLetterAttachments', rpLetterId },
      })
      throw err
    }
  },

  finalizeLetter: async (rpLetterId, letter) => {
    try {
      await api.post(`/api/rp/${rpLetterId}/letter/finalize`, letter ? { letter } : undefined)
      // Локально переводим письмо в pending — реестр покажет «создаётся…» без refetch.
      set({
        letters: get().letters.map((l) =>
          l.id === rpLetterId
            ? { ...l, payhubLetterStatus: 'pending' as const, payhubLetterError: null }
            : l,
        ),
      })
      return true
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка отправки письма',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'finalizeLetter', rpLetterId },
      })
      return false
    }
  },

  loadRpFiles: async (id) => {
    const data = await api.get<RpFilesResult>(`/api/rp/${id}/files`)
    return data ?? { payhub: [], service: [] }
  },

  registerServiceFiles: async (id, refs) => {
    await api.post(`/api/rp/${id}/service-files`, { files: refs })
    set({ letters: bumpFilesCount(get().letters, id, refs.length) })
  },

  deleteServiceFile: async (id, fileId) => {
    await api.delete(`/api/rp/${id}/service-files/${fileId}`)
    set({ letters: bumpFilesCount(get().letters, id, -1) })
  },

  loadInvoiceCandidates: async (paymentRequestIds) => {
    if (paymentRequestIds.length === 0) return []
    const data = await api.post<RpInvoiceCandidateGroup[]>('/api/rp/invoice-file-candidates', {
      paymentRequestIds,
    })
    return data ?? []
  },

  attachInvoiceServiceFiles: async (rpLetterId, fileIds) => {
    if (fileIds.length === 0) return 0
    const res = await api.post<{ added: number }>(
      `/api/rp/${rpLetterId}/service-files/from-invoices`,
      { fileIds },
    )
    const added = res?.added ?? 0
    if (added > 0) set({ letters: bumpFilesCount(get().letters, rpLetterId, added) })
    return added
  },

  updateStatus: async (id, status) => {
    try {
      await api.patch(`/api/rp/${id}/status`, { status })
      set({
        letters: get().letters.map((l) => (l.id === id ? { ...l, status } : l)),
      })
      return true
    } catch (err) {
      logError({
        errorType: 'api_error',
        errorMessage: err instanceof Error ? err.message : 'Ошибка смены статуса РП',
        errorStack: err instanceof Error ? err.stack : null,
        metadata: { action: 'updateStatus' },
      })
      return false
    }
  },
}))
