import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { App } from 'antd'
import type React from 'react'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import { useRpStore } from '@/store/rpStore'
import { useRpLetterFiltering } from '@/hooks/useRpLetterFiltering'
import { useAutoRefresh } from '@/hooks/useAutoRefresh'
import type { RpCombo } from '@/components/rp/CreateRpModal'
import type { FilterValues } from '@/components/paymentRequests/RequestFilters'
import type { PaymentRequest, RpDocumentRef, RpLetter, ConstructionSite } from '@/types'

/** Ключ связки заявки (поставщик|подрядчик|объект) — ограничивает выбор заявок в одну РП. */
const comboKey = (r: PaymentRequest) => `${r.supplierId ?? ''}|${r.counterpartyId}|${r.siteId}`

interface UseRpManagementParams {
  /** !isCounterpartyUser — вся РП-логика активна только для внутренних сотрудников. */
  enabled: boolean
  /** Сырые согласованные заявки (для комбинации и состава РП). */
  approvedRequests: PaymentRequest[]
  /** Отфильтрованные согласованные заявки (для таблицы «Согласовано»). */
  filteredApprovedRequests: PaymentRequest[]
  /** Справочник объектов (payhub-сопоставление формы письма). */
  sites: ConstructionSite[]
  /** Общий блок фильтров (применяется и к реестру — только letter-native поля). */
  filters: FilterValues
  /** Открытие заявки в модалке просмотра страницы. */
  setViewRecord: (r: PaymentRequest | null) => void
  /** Общий триггер обновления данных страницы. */
  refreshTrigger: number
  /** Инкремент refreshTrigger — обновляет и заявки, и реестр. */
  bumpRefresh: () => void
  /** Переключение вкладки (onCreated -> реестр). */
  setActiveTab: (key: string) => void
}

/**
 * Ядро логики РП на странице «Заявки на оплату»: реестр писем, членство заявок в РП,
 * режим выбора согласованных заявок и двухшаговый мастер создания РП, а также
 * действия реестра (повтор письма, редактирование, файлы, аннулирование, удаление).
 * Реестр грузится для внутренних сотрудников сразу (независимо от вкладки) — от него
 * зависит счётчик вкладки «Реестр РП»; фильтры влияют только на таблицу.
 */
export function useRpManagement({
  enabled,
  approvedRequests,
  filteredApprovedRequests,
  sites,
  filters,
  setViewRecord,
  refreshTrigger,
  bumpRefresh,
  setActiveTab,
}: UseRpManagementParams) {
  const { message, modal } = App.useApp()

  // Реестр РП + членство заявок в РП
  const letters = useRpStore((s) => s.letters)
  const lettersLoading = useRpStore((s) => s.lettersLoading)
  const lettersLoaded = useRpStore((s) => s.lettersLoaded)
  const loadRegistry = useRpStore((s) => s.loadRegistry)
  const finalizeLetter = useRpStore((s) => s.finalizeLetter)
  const deleteRp = useRpStore((s) => s.deleteRp)
  const annulRp = useRpStore((s) => s.annulRp)
  const updateSentDate = useRpStore((s) => s.updateSentDate)

  // Режим выбора заявок для создания РП (на вкладке «Согласовано»)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [createCombo, setCreateCombo] = useState<RpCombo | null>(null)
  // Шаг 2 создания: форма письма PayHub (документы — снимок из шага 1)
  const [letterOpen, setLetterOpen] = useState(false)
  const [letterDocs, setLetterDocs] = useState<RpDocumentRef[]>([])
  // Редактирование текста письма из реестра
  const [editLetter, setEditLetter] = useState<RpLetter | null>(null)
  // Модалка файлов РП (вложения PayHub + служебные)
  const [filesLetter, setFilesLetter] = useState<RpLetter | null>(null)

  // Реестр грузим сразу (только внутренним): счётчик вкладки «Реестр РП» и focus-refetch
  // должны работать с любой вкладки. Первая загрузка — со спиннером, повторные — silent
  // (без мигания таблицы); признак читаем из стора, а не из deps, чтобы первый успешный
  // ответ не запускал лишний повторный fetch.
  const shouldLoad = enabled
  useEffect(() => {
    if (shouldLoad) loadRegistry({ silent: useRpStore.getState().lettersLoaded })
  }, [shouldLoad, loadRegistry, refreshTrigger])

  // Есть ли письмо в переходном статусе (синхронизация идёт в фоновом воркере).
  const hasPendingLetter = useMemo(
    () => letters.some((l) => l.payhubLetterStatus === 'pending'),
    [letters],
  )

  // Умный опрос реестра: пока есть письмо «создаётся…», молча (без спиннера) тянем /api/rp;
  // как только все письма вышли из pending — опрос сам прекращается.
  const refreshRegistry = useCallback(() => loadRegistry({ silent: true }), [loadRegistry])
  const onPollingCapReached = useCallback(() => {
    logError({
      errorType: 'api_error',
      errorMessage: 'Опрос статуса письма РП остановлен по капу (письмо всё ещё pending)',
      errorStack: null,
      metadata: { action: 'rpRegistryPollingCap' },
    })
  }, [])
  useAutoRefresh({
    enabled,
    refresh: refreshRegistry,
    polling: shouldLoad && hasPendingLetter,
    intervalMs: 5000,
    maxTicks: 120,
    onPollingCapReached,
  })

  // Falling-edge: когда последнее письмо вышло из pending — один раз обновляем связанные
  // данные заявок (РП-поля на записи заявки). dpNumber на «Согласовано» обновляется реактивно.
  const prevHadPendingRef = useRef(false)
  useEffect(() => {
    if (prevHadPendingRef.current && !hasPendingLetter) bumpRefresh()
    prevHadPendingRef.current = hasPendingLetter
  }, [hasPendingLetter, bumpRefresh])

  // requestId -> номер РП (для пометки «в РП» и колонки РП)
  const membership = useMemo(() => {
    const map = new Map<string, string>()
    for (const l of letters) for (const req of l.requests) map.set(req.id, l.number)
    return map
  }, [letters])

  // Согласованные заявки с проставленным номером РП (fallback в колонке «РП»)
  const approvedForTable = useMemo(
    () =>
      filteredApprovedRequests.map((r) =>
        !r.dpNumber && membership.has(r.id) ? { ...r, dpNumber: membership.get(r.id)! } : r,
      ),
    [filteredApprovedRequests, membership],
  )

  // Комбинация первой выбранной заявки — ограничивает дальнейший выбор
  const firstCombo = useMemo(() => {
    if (selectedKeys.length === 0) return null
    const first = approvedRequests.find((r) => r.id === selectedKeys[0])
    return first ? comboKey(first) : null
  }, [selectedKeys, approvedRequests])

  const rowSelection = useMemo(() => {
    if (!selectionMode) return undefined
    return {
      selectedRowKeys: selectedKeys,
      preserveSelectedRowKeys: true,
      onChange: (keys: React.Key[]) => setSelectedKeys(keys as string[]),
      getCheckboxProps: (record: PaymentRequest) => ({
        // record.dpNumber заполнено => заявка уже в РП (или ручной РП): в новую РП нельзя.
        // Поставщик не требуется: РП по СМР создаётся без поставщика (комбо связывает по '').
        disabled:
          membership.has(record.id) ||
          !!record.dpNumber ||
          (firstCombo !== null && comboKey(record) !== firstCombo),
      }),
    }
  }, [selectionMode, selectedKeys, membership, firstCombo])

  const startSelection = useCallback(() => {
    setSelectionMode(true)
    setSelectedKeys([])
  }, [])
  const cancelSelection = useCallback(() => {
    setSelectionMode(false)
    setSelectedKeys([])
  }, [])

  const openCreate = useCallback(() => {
    const selected = approvedRequests.filter((r) => selectedKeys.includes(r.id))
    if (selected.length === 0) {
      message.info('Выберите заявки для РП')
      return
    }
    const first = selected[0]
    // Поставщик необязателен: РП по СМР создаётся без поставщика.
    setCreateCombo({
      supplierId: first.supplierId ?? null,
      counterpartyId: first.counterpartyId,
      siteId: first.siteId,
    })
    setCreateOpen(true)
  }, [approvedRequests, selectedKeys, message])

  const onCreated = useCallback(() => {
    setCreateOpen(false)
    setLetterOpen(false)
    cancelSelection()
    bumpRefresh()
    setActiveTab('rp_registry')
  }, [cancelSelection, bumpRefresh, setActiveTab])

  // Шаг 1 (документы) -> шаг 2 (форма письма); снимок документов идёт в состав РП.
  const openLetterStep = useCallback((docs: RpDocumentRef[]) => {
    setLetterDocs(docs)
    setCreateOpen(false)
    setLetterOpen(true)
  }, [])

  // Выбранные заявки — для автозаполнения содержания письма.
  const selectedRequests = useMemo(
    () => approvedRequests.filter((r) => selectedKeys.includes(r.id)),
    [approvedRequests, selectedKeys],
  )

  // Объект выбранной связки — payhub-сопоставление (проект + заказчик) для формы письма.
  const comboSite = useMemo(
    () => sites.find((s) => s.id === createCombo?.siteId),
    [sites, createCombo],
  )

  // Открытие заявки по клику на номер в реестре
  const openRequestById = useCallback(
    async (id: string) => {
      try {
        const data = await api.get<PaymentRequest>(`/api/payment-requests/${id}`)
        if (data) setViewRecord(data)
      } catch (err) {
        logError({
          errorType: 'api_error',
          errorMessage: err instanceof Error ? err.message : 'Ошибка загрузки заявки',
          errorStack: err instanceof Error ? err.stack : null,
          metadata: { action: 'openRequestFromRp' },
        })
      }
    },
    [setViewRecord],
  )

  // «Создать письмо» (файлы не догружены) / «Повторить» (ошибка) из реестра.
  const retryLetter = useCallback(
    async (id: string) => {
      const ok = await finalizeLetter(id)
      if (ok) message.success('Письмо отправлено в обработку')
      else message.error('Не удалось отправить письмо в обработку')
    },
    [finalizeLetter, message],
  )

  // Аннулирование РП (удаляет письмо в PayHub, статус -> «Аннулировано»).
  const handleAnnulRp = useCallback(
    (letter: RpLetter) => {
      modal.confirm({
        title: 'Аннулировать РП?',
        content: letter.payhubLetterId
          ? 'Письмо в PayHub будет удалено, статус станет «Аннулировано».'
          : 'Статус станет «Аннулировано».',
        okText: 'Аннулировать',
        okButtonProps: { danger: true },
        cancelText: 'Отмена',
        onOk: async () => {
          try {
            await annulRp(letter.id)
            message.success('РП аннулирована')
            // Заявки освобождены (dp очищен, привязка снята) — обновляем реестр и списки заявок.
            bumpRefresh()
          } catch (err) {
            message.error(err instanceof Error ? err.message : 'Не удалось аннулировать РП')
          }
        },
      })
    },
    [modal, annulRp, message, bumpRefresh],
  )

  // Удаление РП (удаляет письмо в PayHub и запись РП).
  const handleDeleteRp = useCallback(
    (letter: RpLetter) => {
      modal.confirm({
        title: 'Удалить РП?',
        content: letter.payhubLetterId
          ? 'Письмо в PayHub тоже будет удалено. Действие необратимо.'
          : 'Действие необратимо.',
        okText: 'Удалить',
        okButtonProps: { danger: true },
        cancelText: 'Отмена',
        onOk: async () => {
          try {
            await deleteRp(letter.id)
            message.success('РП удалена')
            // Заявки освобождены (dp очищен, привязка снята) — обновляем реестр и списки заявок.
            bumpRefresh()
          } catch (err) {
            message.error(err instanceof Error ? err.message : 'Не удалось удалить РП')
          }
        },
      })
    },
    [modal, deleteRp, message, bumpRefresh],
  )

  // Сохранение даты отправки письма из реестра (inline-редактирование в колонке даты).
  const handleSetSentDate = useCallback(
    async (id: string, sentDate: string | null) => {
      try {
        await updateSentDate(id, sentDate)
        message.success(sentDate ? 'Дата отправки сохранена' : 'Дата отправки очищена')
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Не удалось сохранить дату отправки')
      }
    },
    [updateSentDate, message],
  )

  // Фильтрация реестра тем же блоком фильтров (см. useRpLetterFiltering).
  const filteredLetters = useRpLetterFiltering(letters, filters)

  return {
    // Вкладка «Реестр РП»
    filteredLetters,
    // Счётчик вкладки — общее число писем (без фильтров), как у остальных вкладок
    lettersTotal: letters.length,
    lettersLoaded,
    lettersLoading,
    registryHandlers: {
      onOpenRequest: openRequestById,
      onRetryLetter: retryLetter,
      onEdit: setEditLetter,
      onAnnul: handleAnnulRp,
      onDelete: handleDeleteRp,
      onFiles: setFilesLetter,
      onSetSentDate: handleSetSentDate,
    },
    // Вкладка «Согласовано»
    approvedForTable,
    rowSelection,
    // Тулбар «Создать РП»
    selectionMode,
    selectedCount: selectedKeys.length,
    startSelection,
    cancelSelection,
    openCreate,
    // Кластер модалок
    modalsProps: {
      createOpen,
      createCombo,
      requestIds: selectedKeys,
      onCreateClose: () => setCreateOpen(false),
      onNext: openLetterStep,
      letterOpen,
      letterDocs,
      selectedRequests,
      comboSite,
      onLetterClose: () => setLetterOpen(false),
      onCreated,
      editLetter,
      onEditClose: () => setEditLetter(null),
      onEditSaved: bumpRefresh,
      filesLetter,
      onFilesClose: () => setFilesLetter(null),
    },
  }
}
