import { useState, useEffect, useMemo, useCallback } from 'react'
import { Button, Tabs, App, Space } from 'antd'
import { FilterOutlined, PlusOutlined } from '@ant-design/icons'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import { usePaymentRequestsData } from '@/hooks/usePaymentRequestsData'
import { useRequestFiltering } from '@/hooks/useRequestFiltering'
import { usePaymentRequestHandlers } from '@/hooks/usePaymentRequestHandlers'
import { useHeaderStore } from '@/store/headerStore'
import { useRpStore } from '@/store/rpStore'
import { useCommentStore } from '@/store/commentStore'
import useIsMobile from '@/hooks/useIsMobile'
import RequestsTable from '@/components/paymentRequests/RequestsTable'
import RequestFilters from '@/components/paymentRequests/RequestFilters'
import MobileFiltersDrawer from '@/components/paymentRequests/MobileFiltersDrawer'
import ViewRequestModal from '@/components/paymentRequests/ViewRequestModal'
import RpRegistryTable from '@/components/rp/RpRegistryTable'
import CreateRpModal from '@/components/rp/CreateRpModal'
import CreateRpLetterModal from '@/components/rp/CreateRpLetterModal'
import EditRpLetterModal from '@/components/rp/EditRpLetterModal'
import { useRpLetterFiltering } from '@/hooks/useRpLetterFiltering'
import type { RpCombo } from '@/components/rp/CreateRpModal'
import type { FilterValues } from '@/components/paymentRequests/RequestFilters'
import type { PaymentRequest, RpDocumentRef, RpLetter } from '@/types'

const comboKey = (r: PaymentRequest) => `${r.supplierId ?? ''}|${r.counterpartyId}|${r.siteId}`

const DistributionLettersPage = () => {
  const { message, modal } = App.useApp()
  const isMobile = useIsMobile()
  const setHeader = useHeaderStore((s) => s.setHeader)

  const [activeTab, setActiveTab] = useState<'registry' | 'pending' | 'approved'>('registry')
  const [viewRecord, setViewRecord] = useState<PaymentRequest | null>(null)
  const [resubmitRecord, setResubmitRecord] = useState<PaymentRequest | null>(null)
  const [filters, setFilters] = useState<FilterValues>({})
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

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

  useEffect(() => {
    setHeader('Распред.письма')
  }, [setHeader])

  // Реестр РП + членство заявок в РП
  const letters = useRpStore((s) => s.letters)
  const lettersLoading = useRpStore((s) => s.lettersLoading)
  const loadRegistry = useRpStore((s) => s.loadRegistry)
  const finalizeLetter = useRpStore((s) => s.finalizeLetter)
  const deleteRp = useRpStore((s) => s.deleteRp)
  const annulRp = useRpStore((s) => s.annulRp)

  useEffect(() => {
    loadRegistry()
  }, [loadRegistry, refreshTrigger])

  // requestId -> номер РП (для пометки «в РП» и колонки РП)
  const membership = useMemo(() => {
    const map = new Map<string, string>()
    for (const l of letters) for (const req of l.requests) map.set(req.id, l.number)
    return map
  }, [letters])

  // Данные заявок: pending -> очередь ОМТС РП, иначе согласованные
  const dataTab = activeTab === 'pending' ? 'omts_rp' : 'approved'

  const {
    user,
    isAdmin,
    isUser,
    isOmtsUser,
    isCounterpartyUser,
    isOmtsRpUser,
    userDeptInChain,
    requests,
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    omtsRpPendingRequests,
    approvedCount,
    approvalLoading,
    counterparties,
    sites,
    statuses,
    suppliers,
    omtsUsers,
    siteFilterParams,
    canEditRequest,
    fetchRequests,
    fetchCounterparties,
    fetchPendingRequests,
    fetchOmtsRpPendingRequests,
    fetchApprovedCount,
    fetchRejectedCount,
    approveRequest,
    rejectRequest,
    deleteRequest,
    withdrawRequest,
    resubmitRequest,
    updateRequest,
    assignResponsible,
  } = usePaymentRequestsData({
    activeTab: dataTab,
    refreshTrigger,
    adminSelectedStage: 'omts',
    showDeleted: false,
    setFilters,
    isMobile,
    // На странице РП «мои» = созданные мной РП (иная семантика) — авто-дефолт не нужен.
    skipDefaultMyFilter: true,
  })

  const unreadCounts = useCommentStore((s) => s.unreadCounts)
  const fetchUnreadCounts = useCommentStore((s) => s.fetchUnreadCounts)
  useEffect(() => {
    if (user?.id) fetchUnreadCounts(user.id)
  }, [user?.id, fetchUnreadCounts])

  const { filteredApprovedRequests, filteredOmtsRpPendingRequests } = useRequestFiltering({
    requests,
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    omtsRpPendingRequests,
    filters,
    userId: user?.id,
    isAdmin: !!isAdmin,
  })

  const { handleApprove, handleReject, handleAssignResponsible } = usePaymentRequestHandlers({
    user,
    message,
    storeFunctions: {
      fetchRequests,
      fetchCounterparties,
      fetchPendingRequests,
      fetchOmtsRpPendingRequests,
      fetchApprovedCount,
      fetchRejectedCount,
      approveRequest,
      rejectRequest,
      deleteRequest,
      withdrawRequest,
      resubmitRequest,
      updateRequest,
      assignResponsible,
      siteFilterParams,
    },
    uiSetters: { setViewRecord, setResubmitRecord },
    roleFlags: {
      isUser: !!isUser,
      isAdmin: !!isAdmin,
      isCounterpartyUser: !!isCounterpartyUser,
      isOmtsRpUser: !!isOmtsRpUser,
      adminSelectedStage: 'omts',
    },
    contextData: { requests, counterparties, resubmitRecord },
  })

  // Согласованные заявки с проставленным номером РП (fallback в колонке «РП»)
  const approvedForTable = useMemo(
    () =>
      filteredApprovedRequests.map((r) =>
        !r.dpNumber && membership.has(r.id) ? { ...r, dpNumber: membership.get(r.id)! } : r,
      ),
    [filteredApprovedRequests, membership],
  )

  // Открытие заявки по клику на номер в реестре
  const openRequestById = useCallback(async (id: string) => {
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
  }, [])

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
        disabled:
          membership.has(record.id) ||
          !record.supplierId ||
          (firstCombo !== null && comboKey(record) !== firstCombo),
      }),
    }
  }, [selectionMode, selectedKeys, membership, firstCombo])

  const startSelection = () => {
    setSelectionMode(true)
    setSelectedKeys([])
  }
  const cancelSelection = () => {
    setSelectionMode(false)
    setSelectedKeys([])
  }
  const openCreate = () => {
    const selected = approvedRequests.filter((r) => selectedKeys.includes(r.id))
    if (selected.length === 0) {
      message.info('Выберите заявки для РП')
      return
    }
    const first = selected[0]
    if (!first.supplierId) {
      message.error('У заявки не указан поставщик')
      return
    }
    setCreateCombo({
      supplierId: first.supplierId,
      counterpartyId: first.counterpartyId,
      siteId: first.siteId,
    })
    setCreateOpen(true)
  }
  const onCreated = () => {
    setCreateOpen(false)
    setLetterOpen(false)
    cancelSelection()
    setRefreshTrigger((n) => n + 1)
    setActiveTab('registry')
  }

  // Шаг 1 (документы) -> шаг 2 (форма письма); снимок документов идёт в состав РП.
  const openLetterStep = (docs: RpDocumentRef[]) => {
    setLetterDocs(docs)
    setCreateOpen(false)
    setLetterOpen(true)
  }

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

  // «Создать письмо» (файлы не догружены) / «Повторить» (ошибка) из реестра.
  const retryLetter = async (id: string) => {
    const ok = await finalizeLetter(id)
    if (ok) message.success('Письмо отправлено в обработку')
    else message.error('Не удалось отправить письмо в обработку')
  }

  // Аннулирование РП (удаляет письмо в PayHub, статус -> «Аннулировано»).
  const handleAnnulRp = (letter: RpLetter) => {
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
        } catch (err) {
          message.error(err instanceof Error ? err.message : 'Не удалось аннулировать РП')
        }
      },
    })
  }

  // Удаление РП (удаляет письмо в PayHub и запись РП).
  const handleDeleteRp = (letter: RpLetter) => {
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
        } catch (err) {
          message.error(err instanceof Error ? err.message : 'Не удалось удалить РП')
        }
      },
    })
  }

  // Фильтрация реестра тем же блоком фильтров (см. useRpLetterFiltering).
  const filteredLetters = useRpLetterFiltering(letters, filters, user?.id)

  const filterProps = {
    counterparties,
    sites,
    suppliers,
    hideCounterpartyFilter: false,
    hideStatusFilter: true,
    showResponsibleFilter: isAdmin,
    showMyRequestsFilter: isOmtsUser && !isAdmin,
    omtsUsers,
  }

  // Блок фильтров одинаков для всех вкладок, включая «Реестр РП».
  const showRequestFilters = !isMobile && filtersOpen

  const tabItems = [
    {
      key: 'registry',
      label: isMobile ? 'Реестр' : `Реестр РП (${filteredLetters.length})`,
      children: (
        <RpRegistryTable
          letters={filteredLetters}
          isLoading={lettersLoading}
          onOpenRequest={openRequestById}
          onRetryLetter={retryLetter}
          onEdit={setEditLetter}
          onAnnul={handleAnnulRp}
          onDelete={handleDeleteRp}
        />
      ),
    },
    {
      key: 'pending',
      label: isMobile ? 'Н.Сог' : `На согласовании (${omtsRpPendingRequests.length})`,
      children: (
        <RequestsTable
          requests={filteredOmtsRpPendingRequests}
          isLoading={approvalLoading}
          onView={setViewRecord}
          showApprovalActions
          onApprove={handleApprove}
          onReject={handleReject}
          showResponsibleColumn={!isMobile}
          omtsUsers={omtsUsers}
          onAssignResponsible={handleAssignResponsible}
          responsibleFilter={filters.responsibleFilter}
          showOmtsDays={!isMobile}
          unreadCounts={unreadCounts}
          isMobile={isMobile}
        />
      ),
    },
    {
      key: 'approved',
      label: isMobile ? 'Согл.' : `Согласовано (${approvedCount})`,
      children: (
        <RequestsTable
          requests={approvedForTable}
          isLoading={approvalLoading}
          onView={setViewRecord}
          showApprovedDate={!isMobile}
          showResponsibleColumn={!isMobile && (isOmtsUser || isAdmin)}
          omtsUsers={omtsUsers}
          onAssignResponsible={handleAssignResponsible}
          responsibleFilter={filters.responsibleFilter}
          showOmtsDays={!isMobile}
          unreadCounts={unreadCounts}
          isMobile={isMobile}
          rowSelection={rowSelection}
        />
      ),
    },
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: isMobile ? 'calc(100vh - 48px - 8px)' : 'calc(100vh - 64px - 1px - 32px)',
        overflow: 'hidden',
      }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as typeof activeTab)}
        onTabClick={(key) => {
          if (key === activeTab) setRefreshTrigger((n) => n + 1)
        }}
        items={tabItems}
        className="flex-tabs"
        size={isMobile ? 'small' : undefined}
        renderTabBar={(tabBarProps, DefaultTabBar) => (
          <div>
            {showRequestFilters && (
              <RequestFilters
                {...filterProps}
                statuses={statuses}
                values={filters}
                onChange={setFilters}
                onReset={() => setFilters({})}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <DefaultTabBar
                {...tabBarProps}
                style={{ ...tabBarProps.style, flex: 1, marginBottom: 0 }}
              />
              {activeTab === 'approved' && (
                <Space style={{ flexShrink: 0 }}>
                  {!selectionMode ? (
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      size="small"
                      onClick={startSelection}
                    >
                      Создать РП
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="primary"
                        size="small"
                        disabled={selectedKeys.length === 0}
                        onClick={openCreate}
                      >
                        Создать ({selectedKeys.length})
                      </Button>
                      <Button size="small" onClick={cancelSelection}>
                        Отмена
                      </Button>
                    </>
                  )}
                </Space>
              )}
              <Button
                icon={<FilterOutlined />}
                onClick={() =>
                  isMobile ? setMobileFiltersOpen(true) : setFiltersOpen(!filtersOpen)
                }
                type={!isMobile && filtersOpen ? 'primary' : 'default'}
                size="small"
                style={{ flexShrink: 0 }}
              />
            </div>
          </div>
        )}
      />

      <ViewRequestModal
        open={!!viewRecord}
        request={viewRecord}
        onClose={() => setViewRecord(null)}
        canEdit={canEditRequest(viewRecord)}
        canApprove={
          userDeptInChain &&
          !!viewRecord &&
          omtsRpPendingRequests.some((r) => r.id === viewRecord.id)
        }
        canReject={
          !!viewRecord &&
          !viewRecord.approvedAt &&
          (isAdmin ||
            (userDeptInChain && omtsRpPendingRequests.some((r) => r.id === viewRecord.id)))
        }
        onApprove={(requestId, comment) => {
          handleApprove(requestId, comment)
          setViewRecord(null)
        }}
        onReject={(requestId, comment, files) => {
          handleReject(requestId, comment, files)
          setViewRecord(null)
        }}
        onRevisionComplete={() => {
          const [sIds, allS] = siteFilterParams()
          if (isUser) fetchRequests(undefined, sIds, allS)
          else fetchRequests()
        }}
      />

      {isMobile && (
        <MobileFiltersDrawer
          open={mobileFiltersOpen}
          onClose={() => setMobileFiltersOpen(false)}
          {...filterProps}
          statuses={statuses}
          values={filters}
          onChange={setFilters}
          onReset={() => setFilters({})}
        />
      )}

      <CreateRpModal
        open={createOpen}
        combo={createCombo}
        requestIds={selectedKeys}
        onClose={() => setCreateOpen(false)}
        onNext={openLetterStep}
      />

      <CreateRpLetterModal
        open={letterOpen}
        combo={createCombo}
        requestIds={selectedKeys}
        documents={letterDocs}
        selectedRequests={selectedRequests}
        site={comboSite}
        onClose={() => setLetterOpen(false)}
        onCreated={onCreated}
      />

      <EditRpLetterModal
        open={!!editLetter}
        letter={editLetter}
        onClose={() => setEditLetter(null)}
        onSaved={() => setRefreshTrigger((n) => n + 1)}
      />
    </div>
  )
}

export default DistributionLettersPage
