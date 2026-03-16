import { useState, useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Tabs, App, Radio, Switch } from 'antd'
import { PlusOutlined, FilterOutlined } from '@ant-design/icons'
import { supabase } from '@/services/supabase'
import { logError } from '@/services/errorLogger'
import { usePaymentRequestsData } from '@/hooks/usePaymentRequestsData'
import { useRequestFiltering } from '@/hooks/useRequestFiltering'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import { useCommentStore } from '@/store/commentStore'
import { useHeaderStore } from '@/store/headerStore'
import useIsMobile from '@/hooks/useIsMobile'
import type { EditRequestData } from '@/store/paymentRequestStore'
import CreateRequestModal from '@/components/paymentRequests/CreateRequestModal'
import ViewRequestModal from '@/components/paymentRequests/ViewRequestModal'
import RequestsTable from '@/components/paymentRequests/RequestsTable'
import RequestFilters from '@/components/paymentRequests/RequestFilters'
import CounterpartyRequestsView from '@/components/paymentRequests/CounterpartyRequestsView'
import MobileFiltersDrawer from '@/components/paymentRequests/MobileFiltersDrawer'
import MobileActionBar from '@/components/paymentRequests/MobileActionBar'
import type { FilterValues } from '@/components/paymentRequests/RequestFilters'
import type { FileItem } from '@/components/paymentRequests/FileUploadList'
import type { PaymentRequest, Department } from '@/types'

const PaymentRequestsPage = () => {
  const { message } = App.useApp()
  const location = useLocation()
  const nav = useNavigate()
  const isMobile = useIsMobile()

  // UI state
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [viewRecord, setViewRecord] = useState<PaymentRequest | null>(null)
  const [resubmitRecord, setResubmitRecord] = useState<PaymentRequest | null>(null)
  const [activeTab, setActiveTab] = useState('all')
  const [filters, setFiltersState] = useState<FilterValues>(() => {
    try {
      // Миграция старых ключей
      const oldMyRequests = localStorage.getItem('billhub_my_requests_filter')
      const oldResponsible = localStorage.getItem('billhub_responsible_filter')
      const oldResponsibleUserId = localStorage.getItem('billhub_responsible_user_id')
      if (oldMyRequests || oldResponsible || oldResponsibleUserId) {
        const migrated: FilterValues = {}
        if (oldMyRequests) migrated.myRequestsFilter = oldMyRequests as FilterValues['myRequestsFilter']
        if (oldResponsible) migrated.responsibleFilter = oldResponsible as FilterValues['responsibleFilter']
        if (oldResponsibleUserId) migrated.responsibleUserId = oldResponsibleUserId
        localStorage.setItem('billhub_filters', JSON.stringify(migrated))
        localStorage.removeItem('billhub_my_requests_filter')
        localStorage.removeItem('billhub_responsible_filter')
        localStorage.removeItem('billhub_responsible_user_id')
        return migrated
      }
      const saved = localStorage.getItem('billhub_filters')
      if (saved) return JSON.parse(saved) as FilterValues
    } catch { /* ignore */ }
    return {}
  })

  const setFilters = useCallback((val: FilterValues | ((prev: FilterValues) => FilterValues)) => {
    setFiltersState((prev) => {
      const next = typeof val === 'function' ? val(prev) : { ...prev, ...val }
      try {
        // Сохраняем только непустые значения
        const toSave: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(next)) {
          if (v !== undefined && v !== null && v !== '') toSave[k] = v
        }
        if (Object.keys(toSave).length > 0) {
          localStorage.setItem('billhub_filters', JSON.stringify(toSave))
        } else {
          localStorage.removeItem('billhub_filters')
        }
      } catch { /* ignore */ }
      return next
    })
  }, [])
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [adminSelectedStage, setAdminSelectedStage] = useState<Department>('omts')
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [showDeleted, setShowDeleted] = useState(false)

  // Данные
  const {
    user, isCounterpartyUser, isAdmin, isUser, isOmtsUser, isShtabUser, isOmtsRpUser,
    userDeptInChain, totalStages,
    requests, pendingRequests, approvedRequests, rejectedRequests, omtsRpPendingRequests,
    isLoading, approvalLoading,
    counterparties, sites, statuses, suppliers, omtsUsers, uploadTasks,
    siteFilterParams, canEditRequest,
    fetchRequests, fetchCounterparties, fetchPendingRequests, fetchOmtsRpPendingRequests,
    approveRequest, rejectRequest,
    deleteRequest, withdrawRequest, resubmitRequest, updateRequest,
    assignResponsible,
  } = usePaymentRequestsData({
    activeTab,
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
    filteredRequests, filteredPendingRequests, filteredApprovedRequests, filteredRejectedRequests,
    filteredOmtsRpPendingRequests,
    filteredCounterpartyAll, filteredCounterpartyPending, filteredCounterpartyApproved, filteredCounterpartyRejected,
    totalInvoiceAmount, totalInvoiceAmountAll, totalPaidAll,
    totalCounterpartyInvoiceAmountAll, totalCounterpartyPaidAll,
    unassignedOmtsCount,
  } = useRequestFiltering({
    requests, pendingRequests, approvedRequests, rejectedRequests, omtsRpPendingRequests,
    filters, userId: user?.id, isAdmin: !!isAdmin,
  })

  // Открытие заявки по клику на уведомление
  useEffect(() => {
    const state = location.state as { openRequestId?: string } | null
    if (!state?.openRequestId) return
    nav(location.pathname, { replace: true, state: null })

    const loadRequest = async () => {
      try {
        const { data, error } = await supabase
          .from('payment_requests')
          .select(`
            id, request_number, counterparty_id, site_id, status_id,
            delivery_days, delivery_days_type, shipping_condition_id, comment,
            created_by, created_at, total_files, uploaded_files,
            withdrawn_at, withdrawal_comment, current_stage,
            approved_at, rejected_at, rejected_stage,
            resubmit_comment, resubmit_count,
            invoice_amount, invoice_amount_history,
            paid_status_id, total_paid, is_deleted, deleted_at,
            supplier_id, dp_number, dp_date, dp_amount, dp_file_key, dp_file_name, omts_entered_at, omts_approved_at,
            counterparties(name),
            suppliers(name),
            construction_sites(name),
            statuses!payment_requests_status_id_fkey(name, color),
            shipping:payment_request_field_options!payment_requests_shipping_condition_id_fkey(value)
          `)
          .eq('id', state.openRequestId)
          .single()
        if (error || !data) return

        const ct = data.counterparties as unknown as Record<string, unknown> | null
        const sup = data.suppliers as unknown as Record<string, unknown> | null
        const site = data.construction_sites as unknown as Record<string, unknown> | null
        const st = data.statuses as unknown as Record<string, unknown> | null
        const ship = data.shipping as unknown as Record<string, unknown> | null

        setViewRecord({
          id: data.id,
          requestNumber: data.request_number,
          counterpartyId: data.counterparty_id,
          siteId: data.site_id,
          statusId: data.status_id,
          deliveryDays: data.delivery_days,
          deliveryDaysType: data.delivery_days_type ?? 'working',
          shippingConditionId: data.shipping_condition_id,
          comment: data.comment,
          createdBy: data.created_by,
          createdAt: data.created_at,
          totalFiles: data.total_files ?? 0,
          uploadedFiles: data.uploaded_files ?? 0,
          withdrawnAt: data.withdrawn_at,
          withdrawalComment: data.withdrawal_comment,
          currentStage: data.current_stage ?? null,
          approvedAt: data.approved_at,
          rejectedAt: data.rejected_at,
          rejectedStage: data.rejected_stage ?? null,
          resubmitComment: data.resubmit_comment ?? null,
          resubmitCount: data.resubmit_count ?? 0,
          invoiceAmount: data.invoice_amount ?? null,
          invoiceAmountHistory: data.invoice_amount_history ?? [],
          paidStatusId: data.paid_status_id ?? null,
          totalPaid: Number(data.total_paid ?? 0),
          isDeleted: data.is_deleted ?? false,
          deletedAt: data.deleted_at ?? null,
          supplierId: data.supplier_id ?? null,
          dpNumber: data.dp_number ?? null,
          dpDate: data.dp_date ?? null,
          dpAmount: data.dp_amount != null ? Number(data.dp_amount) : null,
          dpFileKey: data.dp_file_key ?? null,
          dpFileName: data.dp_file_name ?? null,
          omtsEnteredAt: data.omts_entered_at ?? null,
          omtsApprovedAt: data.omts_approved_at ?? null,
          counterpartyName: ct?.name as string | undefined,
          supplierName: sup?.name as string | undefined,
          siteName: site?.name as string | undefined,
          statusName: st?.name as string | undefined,
          statusColor: (st?.color as string) ?? null,
          shippingConditionValue: ship?.value as string | undefined,
        } as PaymentRequest)
      } catch (err) {
        logError({ errorType: 'api_error', errorMessage: err instanceof Error ? err.message : 'Ошибка загрузки заявки', errorStack: err instanceof Error ? err.stack : null, metadata: { action: 'openRequestFromNotification' } })
      }
    }
    loadRequest()
  }, [location.state]) // eslint-disable-line react-hooks/exhaustive-deps

  // Заголовок и элементы в шапке
  const setHeader = useHeaderStore((s) => s.setHeader)
  const clearHeader = useHeaderStore((s) => s.clearHeader)

  useEffect(() => {
    // На мобильном не показываем extra и actions в Header
    if (isMobile) {
      setHeader('Заявки на оплату', null, null)
      return
    }

    const extra = (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {activeTab === 'all' && (
          <div
            style={{
              padding: '4px 12px',
              border: '1px solid #d9d9d9',
              borderRadius: '6px',
              backgroundColor: '#fafafa',
              whiteSpace: 'nowrap',
              fontSize: 13,
            }}
          >
            <span style={{ color: '#8c8c8c', marginRight: 6 }}>РП на сумму:</span>
            <span style={{ fontWeight: 500 }}>
              {totalInvoiceAmountAll.toLocaleString('ru-RU', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })} ₽
            </span>
            <span style={{ color: '#d9d9d9', margin: '0 8px' }}>|</span>
            <span style={{ color: '#8c8c8c', marginRight: 6 }}>Оплачено РП:</span>
            <span style={{ fontWeight: 500 }}>
              {totalPaidAll.toLocaleString('ru-RU', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })} ₽
            </span>
          </div>
        )}
        {activeTab === 'pending' && userDeptInChain && (
          <>
            <div
              style={{
                padding: '4px 12px',
                border: '1px solid #d9d9d9',
                borderRadius: '6px',
                backgroundColor: '#fafafa',
                whiteSpace: 'nowrap',
                fontSize: 13,
              }}
            >
              <span style={{ color: '#8c8c8c', marginRight: 6 }}>Сумма счетов:</span>
              <span style={{ fontWeight: 500 }}>
                {totalInvoiceAmount.toLocaleString('ru-RU', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })} ₽
              </span>
            </div>
            {isAdmin && (
              <div
                style={{
                  padding: '4px 12px',
                  border: '1px solid #d9d9d9',
                  borderRadius: '6px',
                  backgroundColor: '#fafafa',
                  whiteSpace: 'nowrap',
                  fontSize: 13,
                }}
              >
                <span style={{ color: '#8c8c8c', marginRight: 6 }}>Не назначено:</span>
                <span
                  style={{
                    fontWeight: 500,
                    color: unassignedOmtsCount > 0 ? '#faad14' : 'inherit'
                  }}
                >
                  {unassignedOmtsCount}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    )

    const actions = (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {isAdmin && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Switch size="small" checked={showDeleted} onChange={setShowDeleted} />
            <span style={{ fontSize: 13, color: '#8c8c8c', whiteSpace: 'nowrap' }}>Удаленные</span>
          </span>
        )}
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateOpen(true)}>
          Добавить
        </Button>
      </div>
    )

    setHeader('Заявки на оплату', extra, actions)
  }, [activeTab, totalInvoiceAmountAll, totalPaidAll, totalInvoiceAmount, unassignedOmtsCount, isAdmin, userDeptInChain, showDeleted, setHeader, isMobile])

  useEffect(() => {
    return () => clearHeader()
  }, [clearHeader])

  // --- Обработчики ---

  const handleEdit = async (id: string, data: EditRequestData, files: FileItem[]) => {
    if (!user?.id) return
    try {
      await updateRequest(id, data, user.id, files.length > 0 ? files.length : undefined)

      if (files.length > 0) {
        const req = requests.find((r) => r.id === id)
        if (req) {
          if (counterparties.length === 0) await fetchCounterparties()
          const cp = useCounterpartyStore.getState().counterparties.find((c) => c.id === req.counterpartyId)
          if (cp) {
            useUploadQueueStore.getState().addTask({
              type: 'request_files',
              requestId: id,
              requestNumber: req.requestNumber,
              counterpartyName: cp.name,
              files: files.map((f) => ({
                file: f.file,
                documentTypeId: f.documentTypeId!,
                pageCount: f.pageCount,
                isAdditional: true,
              })),
              userId: user.id,
            })
          }
        }
      }

      message.success('Заявка обновлена')
      setViewRecord(null)
      const [sIds, allS] = siteFilterParams()
      if (isUser) fetchRequests(undefined, sIds, allS)
      else fetchRequests()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка обновления')
    }
  }

  const handleWithdraw = async (id: string, comment: string) => {
    await withdrawRequest(id, comment || undefined)
    message.success('Заявка отозвана')
    if (isCounterpartyUser && user?.counterpartyId) fetchRequests(user.counterpartyId)
  }

  const handleDelete = async (id: string) => {
    await deleteRequest(id)
    message.success('Заявка перемещена в удаленные')
  }

  const handleApprove = async (requestId: string, comment: string) => {
    if (!user?.id) return
    const department = isAdmin ? adminSelectedStage : user?.department
    if (!department) return
    await approveRequest(requestId, department, user.id, comment)
    message.success('Заявка согласована')
    fetchPendingRequests(department, user.id, isAdmin)
    if (isOmtsRpUser || isAdmin) fetchOmtsRpPendingRequests()
    const [sIds, allS] = siteFilterParams()
    if (isUser) fetchRequests(undefined, sIds, allS)
    else fetchRequests()
  }

  const handleReject = async (requestId: string, comment: string, files?: { id: string; file: File }[]) => {
    if (!user?.id) return
    const department = isAdmin ? adminSelectedStage : user?.department
    if (!department) return
    await rejectRequest(requestId, department, user.id, comment, files)
    message.success('Заявка отклонена')
    fetchPendingRequests(department, user.id, isAdmin)
    if (isOmtsRpUser || isAdmin) fetchOmtsRpPendingRequests()
    const [sIds, allS] = siteFilterParams()
    if (isUser) fetchRequests(undefined, sIds, allS)
    else fetchRequests()
  }

  const handleAssignResponsible = useCallback(async (requestId: string, userId: string) => {
    if (!user?.id) return
    try {
      await assignResponsible(requestId, userId, user.id)
      message.success('Ответственный назначен')
      const [sIds, allS] = siteFilterParams()
      if (isUser) fetchRequests(undefined, sIds, allS)
      else fetchRequests()
    } catch {
      message.error('Ошибка назначения')
    }
  }, [user?.id, assignResponsible, isUser, siteFilterParams, fetchRequests, message])

  const handleResubmit = async (comment: string, files: FileItem[], fieldUpdates: {
    deliveryDays: number
    deliveryDaysType: string
    shippingConditionId: string
    invoiceAmount: number
  }) => {
    if (!resubmitRecord || !user?.counterpartyId || !user?.id) return
    try {
      await resubmitRequest(resubmitRecord.id, comment, user.counterpartyId, user.id, fieldUpdates)

      if (files.length > 0) {
        if (counterparties.length === 0) await fetchCounterparties()
        const cp = useCounterpartyStore.getState().counterparties.find((c) => c.id === user.counterpartyId)
        if (cp) {
          useUploadQueueStore.getState().addTask({
            type: 'request_files',
            requestId: resubmitRecord.id,
            requestNumber: resubmitRecord.requestNumber,
            counterpartyName: cp.name,
            files: files.map((f) => ({
              file: f.file,
              documentTypeId: f.documentTypeId!,
              pageCount: f.pageCount,
              isResubmit: true,
            })),
            userId: user.id,
          })
        }
      }

      message.success('Заявка отправлена повторно')
      setResubmitRecord(null)
      fetchRequests(user.counterpartyId)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка повторной отправки')
    }
  }

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
      <div style={{ display: 'flex', flexDirection: 'column', height: isMobile ? 'calc(100vh - 48px - 8px)' : 'calc(100vh - 64px - 1px - 32px)', overflow: 'hidden' }}>
        <CounterpartyRequestsView
          filteredAll={filteredCounterpartyAll}
          filteredPending={filteredCounterpartyPending}
          filteredApproved={filteredCounterpartyApproved}
          filteredRejected={filteredCounterpartyRejected}
          isLoading={isLoading}
          sites={sites}
          statuses={statuses}
          suppliers={suppliers}
          filters={filters}
          onFiltersChange={setFilters}
          filtersOpen={isMobile ? false : filtersOpen}
          onFiltersToggle={() => isMobile ? setMobileFiltersOpen(true) : setFiltersOpen(!filtersOpen)}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onTabClick={(key) => { if (key === activeTab) setRefreshTrigger((n) => n + 1) }}
          totalInvoiceAmountAll={totalCounterpartyInvoiceAmountAll}
          totalPaidAll={totalCounterpartyPaidAll}
          unreadCounts={unreadCounts}
          onView={setViewRecord}
          onWithdraw={handleWithdraw}
          onResubmit={setResubmitRecord}
          onCreateOpen={() => setIsCreateOpen(true)}
          uploadTasks={uploadTasks}
          totalStages={totalStages}
          isMobile={isMobile}
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
        <ViewRequestModal open={!!viewRecord} request={viewRecord} onClose={() => setViewRecord(null)} />
        <ViewRequestModal
          open={!!resubmitRecord}
          request={resubmitRecord}
          onClose={() => setResubmitRecord(null)}
          resubmitMode
          onResubmit={handleResubmit}
        />
      </div>
    )
  }

  // --- Admin/User UI ---
  const statusFilters = statuses.filter((s) => s.isActive).map((s) => ({ text: s.name, value: s.id }))

  const tabItems = [
    {
      key: 'all',
      label: 'Все',
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
        />
      ),
    },
  ]

  if (userDeptInChain) {
    tabItems.push({
      key: 'pending',
      label: isMobile ? `Согл. (${filteredPendingRequests.length})` : `На согласование (${filteredPendingRequests.length})`,
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
            showResponsibleColumn={!isMobile && (isOmtsUser || (isAdmin && adminSelectedStage === 'omts'))}
            canAssignResponsible={isAdmin}
            omtsUsers={omtsUsers}
            onAssignResponsible={handleAssignResponsible}
            responsibleFilter={filters.responsibleFilter}
            showOmtsDays={!isMobile}
            unreadCounts={unreadCounts}
            isMobile={isMobile}
          />
        </div>
      ),
    })
  }

  if (isOmtsRpUser || isAdmin) {
    tabItems.push({
      key: 'omts_rp',
      label: isMobile ? `ОМТС (${filteredOmtsRpPendingRequests.length})` : `ОМТС РП (${filteredOmtsRpPendingRequests.length})`,
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
        />
      ),
    })
  }

  tabItems.push(
    {
      key: 'approved',
      label: isMobile ? 'Согл.' : 'Согласовано',
      children: (
        <RequestsTable
          requests={filteredApprovedRequests}
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
        />
      ),
    },
    {
      key: 'rejected',
      label: isMobile ? 'Откл.' : 'Отклонено',
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
        />
      ),
    },
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: isMobile ? 'calc(100vh - 48px - 8px)' : 'calc(100vh - 64px - 1px - 32px)', overflow: 'hidden' }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        onTabClick={(key) => { if (key === activeTab) setRefreshTrigger((n) => n + 1) }}
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
              <DefaultTabBar {...tabBarProps} style={{ ...tabBarProps.style, flex: 1, marginBottom: 0 }} />
              {!isMobile && (
                <Button
                  icon={<FilterOutlined />}
                  onClick={() => setFiltersOpen(!filtersOpen)}
                  type={filtersOpen ? 'primary' : 'default'}
                  size="small"
                  style={{ flexShrink: 0 }}
                />
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
        canApprove={userDeptInChain && !!viewRecord && (pendingRequests.some((r) => r.id === viewRecord.id) || omtsRpPendingRequests.some((r) => r.id === viewRecord.id))}
        onApprove={(requestId, comment) => {
          handleApprove(requestId, comment)
          setViewRecord(null)
        }}
        onReject={(requestId, comment, files) => {
          handleReject(requestId, comment, files)
          setViewRecord(null)
        }}
      />
    </div>
  )
}

export default PaymentRequestsPage
