import { useState, useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Tabs, App, Radio } from 'antd'
import { FilterOutlined } from '@ant-design/icons'
import { api } from '@/services/api'
import { logError } from '@/services/errorLogger'
import { usePaymentRequestsData } from '@/hooks/usePaymentRequestsData'
import { useRequestFiltering } from '@/hooks/useRequestFiltering'
import { usePaymentRequestHandlers } from '@/hooks/usePaymentRequestHandlers'
import { usePaymentRequestHeader } from '@/hooks/usePaymentRequestHeader'
import { useCommentStore } from '@/store/commentStore'
import useIsMobile from '@/hooks/useIsMobile'
import CreateRequestModal from '@/components/paymentRequests/CreateRequestModal'
import ViewRequestModal from '@/components/paymentRequests/ViewRequestModal'
import RequestsTable from '@/components/paymentRequests/RequestsTable'
import { DESKTOP_COLUMN_REGISTRY } from '@/components/paymentRequests/RequestsTable'
import ColumnConfigPopover from '@/components/paymentRequests/ColumnConfigPopover'
import { useColumnConfig } from '@/hooks/useColumnConfig'
import RequestFilters from '@/components/paymentRequests/RequestFilters'
import CounterpartyRequestsView from '@/components/paymentRequests/CounterpartyRequestsView'
import MobileFiltersDrawer from '@/components/paymentRequests/MobileFiltersDrawer'
import MobileActionBar from '@/components/paymentRequests/MobileActionBar'
import ExportRegistryModal from '@/components/paymentRequests/ExportRegistryModal'
import RpRegistryTable from '@/components/rp/RpRegistryTable'
import RpModals from '@/components/rp/RpModals'
import RpCreateToolbar from '@/components/rp/RpCreateToolbar'
import { useRpManagement } from '@/hooks/useRpManagement'
import { useAutoRefresh } from '@/hooks/useAutoRefresh'
import { usePersistentRequestFilters } from '@/hooks/usePersistentRequestFilters'
import type { PaymentRequest, Department } from '@/types'

const PaymentRequestsPage = () => {
  const { message } = App.useApp()
  const location = useLocation()
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const {
    config: columnConfig,
    setConfig: setColumnConfig,
    resetConfig: resetColumnConfig,
  } = useColumnConfig()

  // UI state
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [viewRecord, setViewRecord] = useState<PaymentRequest | null>(null)
  const [resubmitRecord, setResubmitRecord] = useState<PaymentRequest | null>(null)
  const [activeTab, setActiveTab] = useState('all')
  const { filters, setFilters } = usePersistentRequestFilters()
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [adminSelectedStage, setAdminSelectedStage] = useState<Department>('omts')
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [showDeleted, setShowDeleted] = useState(false)
  const [isExportOpen, setIsExportOpen] = useState(false)

  // Данные
  const {
    user,
    isCounterpartyUser,
    isAdmin,
    isUser,
    isOmtsUser,
    isShtabUser,
    isOmtsRpUser,
    userDeptInChain,
    totalStages,
    requests,
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    omtsRpPendingRequests,
    approvedCount,
    rejectedCount,
    isLoading,
    approvalLoading,
    counterparties,
    sites,
    statuses,
    suppliers,
    omtsUsers,
    uploadTasks,
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
    // Реестр РП использует данные согласованных заявок (свежесть списка при enrichment).
    activeTab: activeTab === 'rp_registry' ? 'approved' : activeTab,
    refreshTrigger,
    adminSelectedStage,
    showDeleted,
    setFilters,
    isMobile,
  })

  // Непрочитанные комментарии
  const unreadCounts = useCommentStore((s) => s.unreadCounts)
  const fetchUnreadCounts = useCommentStore((s) => s.fetchUnreadCounts)

  useEffect(() => {
    if (user?.id) fetchUnreadCounts(user.id)
  }, [user?.id, fetchUnreadCounts])

  // Фильтрация
  const {
    filteredRequests,
    filteredPendingRequests,
    filteredApprovedRequests,
    filteredRejectedRequests,
    filteredOmtsRpPendingRequests,
    filteredCounterpartyAll,
    filteredCounterpartyRevision,
    filteredCounterpartyPending,
    filteredCounterpartyApproved,
    filteredCounterpartyRejected,
    counterpartyAllCount,
    counterpartyRevisionCount,
    counterpartyPendingCount,
    counterpartyApprovedCount,
    counterpartyRejectedCount,
    totalInvoiceAmount,
    totalInvoiceAmountAll,
    totalPaidAll,
    totalPendingAmountAll,
    totalCounterpartyInvoiceAmountAll,
    totalCounterpartyPaidAll,
    totalCounterpartyPendingAmountAll,
    unassignedOmtsCount,
  } = useRequestFiltering({
    requests,
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    omtsRpPendingRequests,
    filters,
    userId: user?.id,
    isAdmin: !!isAdmin,
  })

  // РП: реестр писем + мастер создания РП из согласованных заявок.
  // Активна только для внутренних сотрудников (counterparty идёт своей веткой ниже).
  const bumpRefresh = useCallback(() => setRefreshTrigger((n) => n + 1), [])
  const rp = useRpManagement({
    enabled: !isCounterpartyUser,
    activeTab,
    approvedRequests,
    filteredApprovedRequests,
    sites,
    filters,
    setViewRecord,
    refreshTrigger,
    bumpRefresh,
    setActiveTab,
  })

  // Управление РП (создание/аннулирование/удаление/редактирование/письмо) — только admin и ОМТС РП.
  const canManageRp = isOmtsRpUser || isAdmin

  // Авто-обновление при возврате на вкладку. Не дёргаем, пока открыта модалка или идёт выбор
  // заявок под РП (лишний refetch в процессе действия не нужен). Интервального опроса нет —
  // им занимается реестр РП (useRpManagement) по переходным статусам письма.
  const pageBusy =
    isCreateOpen || !!viewRecord || !!resubmitRecord || isExportOpen || rp.selectionMode
  useAutoRefresh({
    enabled: !pageBusy,
    refresh: bumpRefresh,
    refetchOnFocus: true,
  })

  // Открытие заявки по клику на уведомление
  useEffect(() => {
    const state = location.state as { openRequestId?: string } | null
    if (!state?.openRequestId) return
    nav(location.pathname, { replace: true, state: null })

    const loadRequest = async () => {
      try {
        const data = await api.get<PaymentRequest>(`/api/payment-requests/${state.openRequestId}`)
        if (!data) return
        setViewRecord(data)
      } catch (err) {
        logError({
          errorType: 'api_error',
          errorMessage: err instanceof Error ? err.message : 'Ошибка загрузки заявки',
          errorStack: err instanceof Error ? err.stack : null,
          metadata: { action: 'openRequestFromNotification' },
        })
      }
    }
    loadRequest()
  }, [location.state]) // eslint-disable-line react-hooks/exhaustive-deps

  // Заголовок страницы
  usePaymentRequestHeader({
    activeTab,
    isMobile,
    isAdmin: !!isAdmin,
    isCounterpartyUser: !!isCounterpartyUser,
    userDeptInChain: !!userDeptInChain,
    showDeleted,
    setShowDeleted,
    setIsCreateOpen,
    setIsExportOpen,
    totalInvoiceAmountAll,
    totalPaidAll,
    totalPendingAmountAll,
    totalInvoiceAmount,
    unassignedOmtsCount,
  })

  // Обработчики действий
  const {
    handleEdit,
    handleDelete,
    handleApprove,
    handleReject,
    handleAssignResponsible,
    handleResubmit,
  } = usePaymentRequestHandlers({
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
      adminSelectedStage,
    },
    contextData: { requests, counterparties, resubmitRecord },
  })

  // Общие пропсы фильтров
  const filterProps = {
    counterparties,
    sites,
    suppliers,
    hideCounterpartyFilter: false,
    hideStatusFilter: true,
    hideSiteFilter: isShtabUser && !isAdmin,
    showResponsibleFilter: isAdmin,
    showMyRequestsFilter: isOmtsUser && !isAdmin,
    omtsUsers,
  }

  // --- Counterparty UI ---
  if (isCounterpartyUser) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: isMobile ? 'calc(100vh - 48px - 8px)' : 'calc(100vh - 64px - 1px - 32px)',
          overflow: 'hidden',
        }}
      >
        <CounterpartyRequestsView
          filteredAll={filteredCounterpartyAll}
          filteredRevision={filteredCounterpartyRevision}
          filteredPending={filteredCounterpartyPending}
          filteredApproved={filteredCounterpartyApproved}
          filteredRejected={filteredCounterpartyRejected}
          allCount={counterpartyAllCount}
          revisionCount={counterpartyRevisionCount}
          pendingCount={counterpartyPendingCount}
          approvedCount={counterpartyApprovedCount}
          rejectedCount={counterpartyRejectedCount}
          isLoading={isLoading}
          sites={sites}
          statuses={statuses}
          suppliers={suppliers}
          filters={filters}
          onFiltersChange={setFilters}
          filtersOpen={isMobile ? false : filtersOpen}
          onFiltersToggle={() =>
            isMobile ? setMobileFiltersOpen(true) : setFiltersOpen(!filtersOpen)
          }
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onTabClick={(key) => {
            if (key === activeTab) setRefreshTrigger((n) => n + 1)
          }}
          totalInvoiceAmountAll={totalCounterpartyInvoiceAmountAll}
          totalPendingAmountAll={totalCounterpartyPendingAmountAll}
          totalPaidAll={totalCounterpartyPaidAll}
          unreadCounts={unreadCounts}
          onView={setViewRecord}
          onResubmit={setResubmitRecord}
          onCreateOpen={() => setIsCreateOpen(true)}
          uploadTasks={uploadTasks}
          totalStages={totalStages}
          isMobile={isMobile}
          columnConfig={columnConfig}
        />
        {isMobile && (
          <>
            <MobileActionBar
              onAdd={() => setIsCreateOpen(true)}
              onFilterToggle={() => setMobileFiltersOpen(true)}
              filters={filters}
            />
            <MobileFiltersDrawer
              open={mobileFiltersOpen}
              onClose={() => setMobileFiltersOpen(false)}
              sites={sites}
              statuses={statuses}
              suppliers={suppliers}
              hideCounterpartyFilter
              hideStatusFilter
              values={filters}
              onChange={setFilters}
              onReset={() => setFilters(() => ({}))}
            />
          </>
        )}
        <CreateRequestModal
          open={isCreateOpen}
          onClose={() => {
            setIsCreateOpen(false)
            if (user?.counterpartyId) fetchRequests(user.counterpartyId)
          }}
        />
        <ViewRequestModal
          open={!!viewRecord}
          request={viewRecord}
          onClose={() => setViewRecord(null)}
          onRevisionComplete={() => {
            if (user?.counterpartyId) fetchRequests(user.counterpartyId)
          }}
        />
        <ViewRequestModal
          open={!!resubmitRecord}
          request={resubmitRecord}
          onClose={() => setResubmitRecord(null)}
          resubmitMode
          onResubmit={handleResubmit}
        />
        {!isCounterpartyUser && user?.id && (
          <ExportRegistryModal
            open={isExportOpen}
            onClose={() => setIsExportOpen(false)}
            requests={requests}
            suppliers={suppliers}
            sites={sites}
            statuses={statuses}
            userId={user.id}
            isShtabUser={!!isShtabUser}
          />
        )}
      </div>
    )
  }

  // --- Admin/User UI ---
  const statusFilters = statuses
    .filter((s) => s.isActive)
    .map((s) => ({ text: s.name, value: s.id }))

  const tabItems = [
    {
      key: 'all',
      label: isMobile ? 'Все' : `Все (${requests.length})`,
      children: (
        <RequestsTable
          requests={filteredRequests}
          isLoading={isLoading}
          onView={setViewRecord}
          isAdmin={isAdmin}
          onDelete={handleDelete}
          uploadTasks={uploadTasks}
          showResponsibleColumn={!isMobile && (isOmtsUser || isAdmin)}
          canAssignResponsible={false}
          omtsUsers={omtsUsers}
          onAssignResponsible={handleAssignResponsible}
          responsibleFilter={filters.responsibleFilter}
          statusFilters={statusFilters}
          showOmtsDays={!isMobile}
          unreadCounts={unreadCounts}
          isMobile={isMobile}
          columnConfig={columnConfig}
        />
      ),
    },
  ]

  if (userDeptInChain) {
    tabItems.push({
      key: 'pending',
      label: isMobile ? 'Н.Сог' : `На согласование (${pendingRequests.length})`,
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          {isAdmin && (
            <div style={{ marginBottom: 8, flexShrink: 0 }}>
              <Radio.Group
                value={adminSelectedStage}
                onChange={(e) => setAdminSelectedStage(e.target.value)}
                buttonStyle="solid"
                size={isMobile ? 'small' : undefined}
              >
                <Radio.Button value="shtab">Объекты</Radio.Button>
                <Radio.Button value="omts">ОМТС</Radio.Button>
              </Radio.Group>
            </div>
          )}
          <RequestsTable
            requests={filteredPendingRequests}
            isLoading={approvalLoading}
            onView={setViewRecord}
            showApprovalActions
            onApprove={handleApprove}
            onReject={handleReject}
            showResponsibleColumn={
              !isMobile && (isOmtsUser || (isAdmin && adminSelectedStage === 'omts'))
            }
            canAssignResponsible={isAdmin}
            omtsUsers={omtsUsers}
            onAssignResponsible={handleAssignResponsible}
            responsibleFilter={filters.responsibleFilter}
            showOmtsDays={!isMobile}
            unreadCounts={unreadCounts}
            isMobile={isMobile}
            columnConfig={columnConfig}
          />
        </div>
      ),
    })
  }

  if (isOmtsRpUser || isAdmin) {
    tabItems.push({
      key: 'omts_rp',
      label: isMobile ? 'ОМТС' : `ОМТС РП (${omtsRpPendingRequests.length})`,
      children: (
        <RequestsTable
          requests={filteredOmtsRpPendingRequests}
          isLoading={approvalLoading}
          onView={setViewRecord}
          showApprovalActions
          onApprove={handleApprove}
          onReject={handleReject}
          showResponsibleColumn={!isMobile}
          canAssignResponsible={false}
          omtsUsers={omtsUsers}
          onAssignResponsible={handleAssignResponsible}
          responsibleFilter={filters.responsibleFilter}
          showOmtsDays={!isMobile}
          unreadCounts={unreadCounts}
          isMobile={isMobile}
          columnConfig={columnConfig}
        />
      ),
    })
  }

  tabItems.push(
    {
      key: 'approved',
      label: isMobile ? 'Согл.' : `Согласовано (${approvedCount})`,
      children: (
        <RequestsTable
          requests={rp.approvedForTable}
          isLoading={approvalLoading}
          onView={setViewRecord}
          showApprovedDate={!isMobile}
          showResponsibleColumn={!isMobile && (isOmtsUser || isAdmin)}
          canAssignResponsible={false}
          omtsUsers={omtsUsers}
          onAssignResponsible={handleAssignResponsible}
          responsibleFilter={filters.responsibleFilter}
          showOmtsDays={!isMobile}
          unreadCounts={unreadCounts}
          isMobile={isMobile}
          columnConfig={columnConfig}
          rowSelection={rp.rowSelection}
        />
      ),
    },
    {
      key: 'rejected',
      label: isMobile ? 'Откл.' : `Отклонено (${rejectedCount})`,
      children: (
        <RequestsTable
          requests={filteredRejectedRequests}
          isLoading={approvalLoading}
          onView={setViewRecord}
          showRejectedDate={!isMobile}
          showResponsibleColumn={!isMobile && (isOmtsUser || isAdmin)}
          canAssignResponsible={false}
          omtsUsers={omtsUsers}
          onAssignResponsible={handleAssignResponsible}
          responsibleFilter={filters.responsibleFilter}
          showOmtsDays={!isMobile}
          unreadCounts={unreadCounts}
          isMobile={isMobile}
          columnConfig={columnConfig}
        />
      ),
    },
    {
      key: 'rp_registry',
      label: isMobile ? 'Реестр' : `Реестр РП (${rp.filteredLetters.length})`,
      children: (
        <RpRegistryTable
          letters={rp.filteredLetters}
          isLoading={rp.lettersLoading}
          canManage={canManageRp}
          onOpenRequest={rp.registryHandlers.onOpenRequest}
          onRetryLetter={rp.registryHandlers.onRetryLetter}
          onEdit={rp.registryHandlers.onEdit}
          onAnnul={rp.registryHandlers.onAnnul}
          onDelete={rp.registryHandlers.onDelete}
          onFiles={rp.registryHandlers.onFiles}
        />
      ),
    },
  )

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
        onChange={setActiveTab}
        onTabClick={(key) => {
          if (key === activeTab) setRefreshTrigger((n) => n + 1)
        }}
        items={tabItems}
        className="flex-tabs"
        size={isMobile ? 'small' : undefined}
        renderTabBar={(tabBarProps, DefaultTabBar) => (
          <div>
            {!isMobile && filtersOpen && (
              <RequestFilters
                {...filterProps}
                statuses={statuses}
                values={filters}
                onChange={setFilters}
                onReset={() => setFilters(() => ({}))}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <DefaultTabBar
                {...tabBarProps}
                style={{ ...tabBarProps.style, flex: 1, marginBottom: 0 }}
              />
              {!isMobile && (
                <>
                  {activeTab === 'approved' && canManageRp && (
                    <RpCreateToolbar
                      selectionMode={rp.selectionMode}
                      selectedCount={rp.selectedCount}
                      onStart={rp.startSelection}
                      onCreate={rp.openCreate}
                      onCancel={rp.cancelSelection}
                    />
                  )}
                  {activeTab !== 'rp_registry' && (
                    <ColumnConfigPopover
                      availableColumns={DESKTOP_COLUMN_REGISTRY}
                      config={columnConfig}
                      onChange={setColumnConfig}
                      onReset={resetColumnConfig}
                    />
                  )}
                  <Button
                    icon={<FilterOutlined />}
                    onClick={() => setFiltersOpen(!filtersOpen)}
                    type={filtersOpen ? 'primary' : 'default'}
                    size="small"
                    style={{ flexShrink: 0 }}
                  />
                </>
              )}
            </div>
          </div>
        )}
      />

      {isMobile && (
        <>
          <MobileActionBar
            onAdd={() => setIsCreateOpen(true)}
            onFilterToggle={() => setMobileFiltersOpen(true)}
            filters={filters}
            onExport={() => setIsExportOpen(true)}
          />
          <MobileFiltersDrawer
            open={mobileFiltersOpen}
            onClose={() => setMobileFiltersOpen(false)}
            {...filterProps}
            statuses={statuses}
            values={filters}
            onChange={setFilters}
            onReset={() => setFilters(() => ({}))}
          />
        </>
      )}

      <CreateRequestModal
        open={isCreateOpen}
        onClose={() => {
          setIsCreateOpen(false)
          const [sIds, allS] = siteFilterParams()
          if (isUser) fetchRequests(undefined, sIds, allS)
          else fetchRequests()
        }}
      />
      <ViewRequestModal
        open={!!viewRecord}
        request={viewRecord}
        onClose={() => setViewRecord(null)}
        canEdit={canEditRequest(viewRecord)}
        onEdit={handleEdit}
        canApprove={
          userDeptInChain &&
          !!viewRecord &&
          (pendingRequests.some((r) => r.id === viewRecord.id) ||
            omtsRpPendingRequests.some((r) => r.id === viewRecord.id))
        }
        canReject={
          !!viewRecord &&
          !viewRecord.approvedAt &&
          (isAdmin
            ? true
            : userDeptInChain &&
              (pendingRequests.some((r) => r.id === viewRecord.id) ||
                omtsRpPendingRequests.some((r) => r.id === viewRecord.id)))
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
          if (isCounterpartyUser) fetchRequests(user?.counterpartyId ?? undefined, sIds, allS)
          else if (isUser) fetchRequests(undefined, sIds, allS)
          else fetchRequests()
        }}
      />
      {user?.id && (
        <ExportRegistryModal
          open={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          requests={requests}
          suppliers={suppliers}
          sites={sites}
          statuses={statuses}
          userId={user.id}
          isShtabUser={!!isShtabUser}
        />
      )}
      <RpModals {...rp.modalsProps} />
    </div>
  )
}

export default PaymentRequestsPage
