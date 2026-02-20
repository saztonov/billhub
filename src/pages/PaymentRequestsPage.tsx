import { useState, useCallback } from 'react'
import { Typography, Button, Tabs, App, Radio, Switch } from 'antd'
import { PlusOutlined, FilterOutlined } from '@ant-design/icons'
import { usePaymentRequestsData } from '@/hooks/usePaymentRequestsData'
import { useRequestFiltering } from '@/hooks/useRequestFiltering'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import type { EditRequestData } from '@/store/paymentRequestStore'
import CreateRequestModal from '@/components/paymentRequests/CreateRequestModal'
import ViewRequestModal from '@/components/paymentRequests/ViewRequestModal'
import RequestsTable from '@/components/paymentRequests/RequestsTable'
import RequestFilters from '@/components/paymentRequests/RequestFilters'
import CounterpartyRequestsView from '@/components/paymentRequests/CounterpartyRequestsView'
import type { FilterValues } from '@/components/paymentRequests/RequestFilters'
import type { FileItem } from '@/components/paymentRequests/FileUploadList'
import type { PaymentRequest, Department } from '@/types'

const { Title } = Typography

const PaymentRequestsPage = () => {
  const { message } = App.useApp()

  // UI state
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [viewRecord, setViewRecord] = useState<PaymentRequest | null>(null)
  const [resubmitRecord, setResubmitRecord] = useState<PaymentRequest | null>(null)
  const [activeTab, setActiveTab] = useState('all')
  const [filters, setFilters] = useState<FilterValues>({})
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [adminSelectedStage, setAdminSelectedStage] = useState<Department>('omts')
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [showDeleted, setShowDeleted] = useState(false)

  // Данные
  const {
    user, isCounterpartyUser, isAdmin, isUser, isOmtsUser,
    userDeptInChain, totalStages,
    requests, pendingRequests, approvedRequests, rejectedRequests,
    isLoading, approvalLoading,
    counterparties, sites, omtsUsers, uploadTasks,
    siteFilterParams, canEditRequest,
    fetchRequests, fetchCounterparties, fetchPendingRequests,
    approveRequest, rejectRequest,
    deleteRequest, withdrawRequest, resubmitRequest, updateRequest,
    assignResponsible,
  } = usePaymentRequestsData({
    activeTab,
    refreshTrigger,
    adminSelectedStage,
    showDeleted,
    setFilters,
  })

  // Фильтрация
  const {
    filteredRequests, filteredPendingRequests, filteredApprovedRequests, filteredRejectedRequests,
    filteredCounterpartyAll, filteredCounterpartyPending, filteredCounterpartyApproved, filteredCounterpartyRejected,
    totalInvoiceAmount, unassignedOmtsCount,
  } = useRequestFiltering({
    requests, pendingRequests, approvedRequests, rejectedRequests,
    filters, userId: user?.id, isAdmin: !!isAdmin,
  })

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

  // --- Counterparty UI ---
  if (isCounterpartyUser) {
    return (
      <div>
        <CounterpartyRequestsView
          filteredAll={filteredCounterpartyAll}
          filteredPending={filteredCounterpartyPending}
          filteredApproved={filteredCounterpartyApproved}
          filteredRejected={filteredCounterpartyRejected}
          isLoading={isLoading}
          sites={sites}
          filters={filters}
          onFiltersChange={setFilters}
          filtersOpen={filtersOpen}
          onFiltersToggle={() => setFiltersOpen(!filtersOpen)}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onTabClick={(key) => { if (key === activeTab) setRefreshTrigger((n) => n + 1) }}
          onView={setViewRecord}
          onWithdraw={handleWithdraw}
          onResubmit={setResubmitRecord}
          onCreateOpen={() => setIsCreateOpen(true)}
          uploadTasks={uploadTasks}
          totalStages={totalStages}
        />
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
          showResponsibleColumn={isOmtsUser || isAdmin}
          canAssignResponsible={false}
          omtsUsers={omtsUsers}
          onAssignResponsible={handleAssignResponsible}
          responsibleFilter={filters.responsibleFilter}
        />
      ),
    },
  ]

  if (userDeptInChain) {
    tabItems.push({
      key: 'pending',
      label: `На согласование (${filteredPendingRequests.length})`,
      children: (
        <div>
          {isAdmin && (
            <div style={{ marginBottom: 16 }}>
              <Radio.Group
                value={adminSelectedStage}
                onChange={(e) => setAdminSelectedStage(e.target.value)}
                buttonStyle="solid"
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
            showResponsibleColumn={isOmtsUser || (isAdmin && adminSelectedStage === 'omts')}
            canAssignResponsible={isAdmin}
            omtsUsers={omtsUsers}
            onAssignResponsible={handleAssignResponsible}
            responsibleFilter={filters.responsibleFilter}
          />
        </div>
      ),
    })
  }

  tabItems.push(
    {
      key: 'approved',
      label: 'Согласовано',
      children: (
        <RequestsTable
          requests={filteredApprovedRequests}
          isLoading={approvalLoading}
          onView={setViewRecord}
          showApprovedDate
          showResponsibleColumn={isOmtsUser || isAdmin}
          canAssignResponsible={false}
          omtsUsers={omtsUsers}
          onAssignResponsible={handleAssignResponsible}
          responsibleFilter={filters.responsibleFilter}
        />
      ),
    },
    {
      key: 'rejected',
      label: 'Отклонено',
      children: (
        <RequestsTable
          requests={filteredRejectedRequests}
          isLoading={approvalLoading}
          onView={setViewRecord}
          showRejectedDate
          showResponsibleColumn={isOmtsUser || isAdmin}
          canAssignResponsible={false}
          omtsUsers={omtsUsers}
          onAssignResponsible={handleAssignResponsible}
          responsibleFilter={filters.responsibleFilter}
        />
      ),
    },
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Title level={2} style={{ margin: 0 }}>Заявки на оплату</Title>
          <Button
            icon={<FilterOutlined />}
            onClick={() => setFiltersOpen(!filtersOpen)}
            type={filtersOpen ? 'primary' : 'default'}
          />
          {activeTab === 'pending' && userDeptInChain && (
            <>
              <div
                style={{
                  padding: '8px 16px',
                  border: '1px solid #d9d9d9',
                  borderRadius: '6px',
                  backgroundColor: '#fafafa',
                  whiteSpace: 'nowrap'
                }}
              >
                <span style={{ color: '#8c8c8c', marginRight: 8 }}>Сумма счетов:</span>
                <span style={{ fontWeight: 500, fontSize: '16px' }}>
                  {totalInvoiceAmount.toLocaleString('ru-RU', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })} ₽
                </span>
              </div>
              {isAdmin && (
                <div
                  style={{
                    padding: '8px 16px',
                    border: '1px solid #d9d9d9',
                    borderRadius: '6px',
                    backgroundColor: '#fafafa',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <span style={{ color: '#8c8c8c', marginRight: 8 }}>Не назначено:</span>
                  <span
                    style={{
                      fontWeight: 500,
                      fontSize: '16px',
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
      </div>
      {filtersOpen && (
        <RequestFilters
          counterparties={counterparties}
          sites={sites}
          hideCounterpartyFilter={false}
          hideStatusFilter={true}
          showResponsibleFilter={isAdmin}
          showMyRequestsFilter={isOmtsUser && !isAdmin}
          omtsUsers={omtsUsers}
          values={filters}
          onChange={setFilters}
          onReset={() => setFilters({})}
        />
      )}
      <Tabs activeKey={activeTab} onChange={setActiveTab} onTabClick={(key) => { if (key === activeTab) setRefreshTrigger((n) => n + 1) }} items={tabItems} />
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
        canApprove={userDeptInChain && !!viewRecord && pendingRequests.some((r) => r.id === viewRecord.id)}
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
