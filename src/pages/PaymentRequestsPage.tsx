import { useEffect, useMemo, useState, useCallback } from 'react'
import { Typography, Button, Tabs, App, Radio } from 'antd'
import { PlusOutlined, FilterOutlined } from '@ant-design/icons'
import { usePaymentRequestStore } from '@/store/paymentRequestStore'
import type { EditRequestData } from '@/store/paymentRequestStore'
import { useAuthStore } from '@/store/authStore'
import { useUploadQueueStore } from '@/store/uploadQueueStore'
import { useApprovalStore } from '@/store/approvalStore'
import { supabase } from '@/services/supabase'
import CreateRequestModal from '@/components/paymentRequests/CreateRequestModal'
import ViewRequestModal from '@/components/paymentRequests/ViewRequestModal'
import RequestsTable from '@/components/paymentRequests/RequestsTable'
import { useCounterpartyStore } from '@/store/counterpartyStore'
import { useConstructionSiteStore } from '@/store/constructionSiteStore'
import { useStatusStore } from '@/store/statusStore'
import { useAssignmentStore } from '@/store/assignmentStore'
import RequestFilters from '@/components/paymentRequests/RequestFilters'
import type { FilterValues } from '@/components/paymentRequests/RequestFilters'
import type { FileItem } from '@/components/paymentRequests/FileUploadList'
import type { PaymentRequest, Department } from '@/types'

const { Title } = Typography

/** Загрузить объекты пользователя из БД */
async function loadUserSiteIds(userId: string): Promise<{ allSites: boolean; siteIds: string[] }> {
  const { data: userData } = await supabase
    .from('users')
    .select('all_sites')
    .eq('id', userId)
    .single()
  const allSites = (userData?.all_sites as boolean) ?? false
  if (allSites) return { allSites: true, siteIds: [] }

  const { data: mappings } = await supabase
    .from('user_construction_sites_mapping')
    .select('construction_site_id')
    .eq('user_id', userId)
  const siteIds = (mappings ?? []).map((m: Record<string, unknown>) => m.construction_site_id as string)
  return { allSites: false, siteIds }
}

const PaymentRequestsPage = () => {
  const { message } = App.useApp()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [viewRecord, setViewRecord] = useState<PaymentRequest | null>(null)
  const [resubmitRecord, setResubmitRecord] = useState<PaymentRequest | null>(null)
  const [activeTab, setActiveTab] = useState('all')
  const [userSiteIds, setUserSiteIds] = useState<string[]>([])
  const [userAllSites, setUserAllSites] = useState(true)
  const [sitesLoaded, setSitesLoaded] = useState(false)
  const [filters, setFilters] = useState<FilterValues>({})
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [adminSelectedStage, setAdminSelectedStage] = useState<Department>('omts') // Для админа: выбор этапа согласования

  const user = useAuthStore((s) => s.user)

  // Разворачиваем фильтры по умолчанию для контрагента
  useEffect(() => {
    if (user?.role === 'counterparty_user') {
      setFiltersOpen(true)
    }
  }, [user?.role])
  const isCounterpartyUser = user?.role === 'counterparty_user'
  const isAdmin = user?.role === 'admin'
  const isUser = user?.role === 'user'
  const isOmtsUser = user?.department === 'omts'

  const {
    requests,
    isLoading,
    fetchRequests,
    deleteRequest,
    withdrawRequest,
    resubmitRequest,
    updateRequest,
  } = usePaymentRequestStore()

  const { counterparties, fetchCounterparties } = useCounterpartyStore()
  const { sites, fetchSites } = useConstructionSiteStore()
  const { statuses, fetchStatuses } = useStatusStore()
  const { omtsUsers, fetchOmtsUsers, assignResponsible } = useAssignmentStore()

  const retryTask = useUploadQueueStore((s) => s.retryTask)
  const uploadTasks = useUploadQueueStore((s) => s.tasks)

  const {
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    isLoading: approvalLoading,
    fetchPendingRequests,
    fetchApprovedRequests,
    fetchRejectedRequests,
    approveRequest,
    rejectRequest,
  } = useApprovalStore()

  // Загружаем объекты пользователя для role=user
  useEffect(() => {
    if (!user?.id || !isUser) {
      setSitesLoaded(true)
      return
    }
    loadUserSiteIds(user.id).then(({ allSites, siteIds }) => {
      setUserAllSites(allSites)
      setUserSiteIds(siteIds)
      setSitesLoaded(true)
    })
  }, [user?.id, isUser])

  // Общее количество уникальных этапов согласования (жесткая цепочка: Штаб → ОМТС)
  const totalStages = 2

  // Проверяем, участвует ли подразделение пользователя в цепочке (только Штаб и ОМТС)
  // Для админа вкладка всегда видна
  const userDeptInChain = useMemo(() => {
    if (isAdmin) return true // Админ всегда видит вкладку "На согласовании"
    if (!user?.department) return false
    return user.department === 'shtab' || user.department === 'omts'
  }, [isAdmin, user?.department])

  // Параметры фильтрации для role=user
  const siteFilterParams = useCallback((): [string[]?, boolean?] => {
    if (!isUser) return [undefined, undefined]
    return [userSiteIds, userAllSites]
  }, [isUser, userSiteIds, userAllSites])

  useEffect(() => {
    if (!sitesLoaded) return
    if (isCounterpartyUser && user?.counterpartyId) {
      fetchRequests(user.counterpartyId)
    } else if (isAdmin) {
      fetchRequests()
    } else if (isUser) {
      fetchRequests(undefined, userSiteIds, userAllSites)
    }
  }, [fetchRequests, isCounterpartyUser, isAdmin, isUser, user?.counterpartyId, sitesLoaded, userSiteIds, userAllSites])

  // Загружаем pendingRequests для счетчика вкладки (независимо от activeTab)
  useEffect(() => {
    if (isCounterpartyUser || !sitesLoaded || !user?.id) return
    const department = isAdmin ? adminSelectedStage : user?.department
    if (department && userDeptInChain) {
      fetchPendingRequests(department, user.id, isAdmin)
    }
  }, [isCounterpartyUser, sitesLoaded, user?.id, user?.department, isAdmin, adminSelectedStage, userDeptInChain, fetchPendingRequests])

  // Загружаем данные при переключении вкладок для всех ролей
  useEffect(() => {
    if (!sitesLoaded) return

    // Для контрагента: обновляем базовый список заявок для всех вкладок
    if (isCounterpartyUser && user?.counterpartyId) {
      fetchRequests(user.counterpartyId)
      return
    }

    // Для user/admin: обновляем данные в зависимости от вкладки
    const [sIds, allS] = siteFilterParams()

    if (activeTab === 'all') {
      // Вкладка "Все"
      if (isUser) {
        fetchRequests(undefined, sIds, allS)
      } else if (isAdmin) {
        fetchRequests()
      }
    } else if (activeTab === 'pending') {
      // Вкладка "На согласование"
      if (user?.id && userDeptInChain) {
        const department = isAdmin ? adminSelectedStage : user?.department
        if (department) {
          fetchPendingRequests(department, user.id, isAdmin)
        }
      }
    } else if (activeTab === 'approved') {
      // Вкладка "Согласовано"
      fetchApprovedRequests(sIds, allS)
    } else if (activeTab === 'rejected') {
      // Вкладка "Отклонено"
      fetchRejectedRequests(sIds, allS)
    }
  }, [activeTab, sitesLoaded, isCounterpartyUser, user?.counterpartyId, user?.id, user?.department, isUser, isAdmin, adminSelectedStage, userDeptInChain, userSiteIds, userAllSites, fetchRequests, fetchPendingRequests, fetchApprovedRequests, fetchRejectedRequests])

  // Загружаем справочники для фильтров
  useEffect(() => {
    if (!isCounterpartyUser) {
      fetchCounterparties()
      fetchSites()
      fetchStatuses('payment_request')
    } else {
      // Для counterparty_user загружаем только объекты (для фильтров)
      fetchSites()
    }
  }, [isCounterpartyUser, fetchCounterparties, fetchSites, fetchStatuses])

  // Загружаем список ОМТС для назначения (для пользователей ОМТС и для админов)
  useEffect(() => {
    if (isOmtsUser || isAdmin) {
      fetchOmtsUsers()
    }
  }, [isOmtsUser, isAdmin, fetchOmtsUsers])

  /** Проверяет, может ли текущий пользователь редактировать заявку */
  const canEditRequest = useCallback((record: PaymentRequest | null): boolean => {
    if (!record || isCounterpartyUser) return false
    if (isAdmin) return true
    // user может редактировать заявки своих объектов
    if (isUser) {
      // Если all_sites=true, может редактировать все заявки
      if (userAllSites) return true
      // Если all_sites=false, может редактировать только заявки своих объектов
      return userSiteIds.includes(record.siteId)
    }
    return false
  }, [isAdmin, isCounterpartyUser, isUser, userAllSites, userSiteIds, user?.role])

  /** Обработчик сохранения редактирования */
  const handleEdit = async (id: string, data: EditRequestData, files: FileItem[]) => {
    if (!user?.id) return
    try {
      await updateRequest(id, data, user.id, files.length > 0 ? files.length : undefined)

      // Если есть новые файлы — загружаем через очередь
      if (files.length > 0) {
        // Находим заявку для получения данных
        const req = requests.find((r) => r.id === id)
        if (req) {
          if (counterparties.length === 0) await fetchCounterparties()
          const cp = useCounterpartyStore.getState().counterparties.find((c) => c.id === req.counterpartyId)
          if (cp) {
            const addUploadTask = useUploadQueueStore.getState().addTask
            addUploadTask({
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
      // Обновляем список
      const [sIds, allS] = siteFilterParams()
      if (isUser) {
        fetchRequests(undefined, sIds, allS)
      } else {
        fetchRequests()
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Ошибка обновления'
      message.error(errorMsg)
    }
  }

  const handleWithdraw = async (id: string, comment: string) => {
    await withdrawRequest(id, comment || undefined)
    message.success('Заявка отозвана')
    if (isCounterpartyUser && user?.counterpartyId) {
      fetchRequests(user.counterpartyId)
    }
  }

  const handleDelete = async (id: string) => {
    await deleteRequest(id)
    message.success('Заявка удалена')
  }

  const handleApprove = async (requestId: string, comment: string) => {
    if (!user?.id) return
    // Для админа используем выбранный этап, для обычных пользователей - их department
    const department = isAdmin ? adminSelectedStage : user?.department
    if (!department) return
    await approveRequest(requestId, department, user.id, comment)
    message.success('Заявка согласована')
    fetchPendingRequests(department, user.id, isAdmin)
    const [sIds, allS] = siteFilterParams()
    if (isUser) {
      fetchRequests(undefined, sIds, allS)
    } else {
      fetchRequests()
    }
  }

  const handleReject = async (requestId: string, comment: string, files?: { id: string; file: File }[]) => {
    if (!user?.id) return
    // Для админа используем выбранный этап, для обычных пользователей - их department
    const department = isAdmin ? adminSelectedStage : user?.department
    if (!department) return
    await rejectRequest(requestId, department, user.id, comment, files)
    message.success('Заявка отклонена')
    fetchPendingRequests(department, user.id, isAdmin)
    const [sIds, allS] = siteFilterParams()
    if (isUser) {
      fetchRequests(undefined, sIds, allS)
    } else {
      fetchRequests()
    }
  }

  const handleAssignResponsible = useCallback(async (requestId: string, userId: string) => {
    if (!user?.id) return
    try {
      await assignResponsible(requestId, userId, user.id)
      message.success('Ответственный назначен')
      // Обновить список заявок
      const [sIds, allS] = siteFilterParams()
      if (isUser) {
        fetchRequests(undefined, sIds, allS)
      } else {
        fetchRequests()
      }
    } catch {
      message.error('Ошибка назначения')
    }
  }, [user?.id, assignResponsible, isUser, siteFilterParams, fetchRequests])

  // Общая функция фильтрации для всех вкладок
  const applyFilters = useCallback((items: PaymentRequest[]) => {
    let filtered = items

    if (filters.counterpartyId) {
      filtered = filtered.filter(r => r.counterpartyId === filters.counterpartyId)
    }
    if (filters.siteId) {
      filtered = filtered.filter(r => r.siteId === filters.siteId)
    }
    if (filters.statusId) {
      filtered = filtered.filter(r => r.statusId === filters.statusId)
    }
    if (filters.requestNumber) {
      filtered = filtered.filter(r =>
        r.requestNumber.toLowerCase().includes(filters.requestNumber!.toLowerCase())
      )
    }
    if (filters.dateFrom) {
      filtered = filtered.filter(r =>
        new Date(r.createdAt) >= new Date(filters.dateFrom!)
      )
    }
    if (filters.dateTo) {
      // Добавляем 1 день к dateTo, чтобы включить конечную дату в фильтр
      const nextDay = new Date(filters.dateTo!)
      nextDay.setDate(nextDay.getDate() + 1)
      filtered = filtered.filter(r =>
        new Date(r.createdAt) < nextDay
      )
    }
    if (filters.responsibleFilter === 'assigned') {
      filtered = filtered.filter(r => r.assignedUserId !== null)
    } else if (filters.responsibleFilter === 'unassigned') {
      filtered = filtered.filter(r => r.assignedUserId === null)
    }
    if (filters.responsibleUserId) {
      filtered = filtered.filter(r => r.assignedUserId === filters.responsibleUserId)
    }

    return filtered
  }, [filters])

  // Фильтрация заявок для всех вкладок
  const filteredRequests = useMemo(() => applyFilters(requests), [requests, applyFilters])
  const filteredPendingRequests = useMemo(() => applyFilters(pendingRequests), [pendingRequests, applyFilters])
  const filteredApprovedRequests = useMemo(() => applyFilters(approvedRequests), [approvedRequests, applyFilters])
  const filteredRejectedRequests = useMemo(() => applyFilters(rejectedRequests), [rejectedRequests, applyFilters])

  // Статистика для вкладки "На согласование"
  const totalInvoiceAmount = useMemo(() => {
    return filteredPendingRequests.reduce((sum, req) => {
      return sum + (req.invoiceAmount ?? 0)
    }, 0)
  }, [filteredPendingRequests])

  const unassignedOmtsCount = useMemo(() => {
    if (!isAdmin) return 0
    return filteredPendingRequests.filter(req =>
      req.currentStage === 2 && !req.assignedUserId
    ).length
  }, [filteredPendingRequests, isAdmin])

  // Фильтрация для counterparty_user (только объект, дата, номер)
  const applyCounterpartyFilters = useCallback((items: PaymentRequest[]) => {
    let filtered = items
    if (filters.siteId) {
      filtered = filtered.filter(r => r.siteId === filters.siteId)
    }
    if (filters.requestNumber) {
      filtered = filtered.filter(r =>
        r.requestNumber.toLowerCase().includes(filters.requestNumber!.toLowerCase())
      )
    }
    if (filters.dateFrom) {
      filtered = filtered.filter(r =>
        new Date(r.createdAt) >= new Date(filters.dateFrom!)
      )
    }
    if (filters.dateTo) {
      // Добавляем 1 день к dateTo, чтобы включить конечную дату в фильтр
      const nextDay = new Date(filters.dateTo!)
      nextDay.setDate(nextDay.getDate() + 1)
      filtered = filtered.filter(r =>
        new Date(r.createdAt) < nextDay
      )
    }
    return filtered
  }, [filters])

  // Разделение заявок counterparty_user по статусам (локальная фильтрация)
  const counterpartyAllRequests = useMemo(() => requests, [requests])
  const counterpartyPendingRequests = useMemo(() =>
    requests.filter(r =>
      r.currentStage !== null &&
      r.approvedAt === null &&
      r.rejectedAt === null &&
      r.withdrawnAt === null
    ), [requests])
  const counterpartyApprovedRequests = useMemo(() =>
    requests.filter(r => r.approvedAt !== null), [requests])
  const counterpartyRejectedRequests = useMemo(() =>
    requests.filter(r => r.rejectedAt !== null), [requests])

  // Применение фильтров к вкладкам counterparty_user
  const filteredCounterpartyAll = useMemo(() =>
    applyCounterpartyFilters(counterpartyAllRequests), [counterpartyAllRequests, applyCounterpartyFilters])
  const filteredCounterpartyPending = useMemo(() =>
    applyCounterpartyFilters(counterpartyPendingRequests), [counterpartyPendingRequests, applyCounterpartyFilters])
  const filteredCounterpartyApproved = useMemo(() =>
    applyCounterpartyFilters(counterpartyApprovedRequests), [counterpartyApprovedRequests, applyCounterpartyFilters])
  const filteredCounterpartyRejected = useMemo(() =>
    applyCounterpartyFilters(counterpartyRejectedRequests), [counterpartyRejectedRequests, applyCounterpartyFilters])

  const handleResubmit = async (comment: string, files: FileItem[]) => {
    if (!resubmitRecord || !user?.counterpartyId || !user?.id) return
    try {
      // Повторная отправка заявки
      await resubmitRequest(resubmitRecord.id, comment, user.counterpartyId)

      // Если есть новые файлы — загружаем через очередь
      if (files.length > 0) {
        // Загружаем контрагентов для имени, если ещё не загружены
        if (counterparties.length === 0) await fetchCounterparties()
        const cp = useCounterpartyStore.getState().counterparties.find((c) => c.id === user.counterpartyId)
        if (cp) {
          // Добавляем файлы в очередь загрузки
          // total_files будет автоматически увеличен в uploadQueueStore при загрузке каждого файла
          const addUploadTask = useUploadQueueStore.getState().addTask
          addUploadTask({
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
      const errorMsg = err instanceof Error ? err.message : 'Ошибка повторной отправки'
      message.error(errorMsg)
    }
  }

  // Для counterparty_user — с вкладками и фильтрами
  if (isCounterpartyUser) {
    const counterpartyTabItems = [
      {
        key: 'all',
        label: 'Все',
        children: (
          <RequestsTable
            requests={filteredCounterpartyAll}
            isLoading={isLoading}
            onView={setViewRecord}
            isCounterpartyUser
            hideCounterpartyColumn
            onWithdraw={handleWithdraw}
            onResubmit={setResubmitRecord}
            uploadTasks={uploadTasks}
            onRetryUpload={retryTask}
            totalStages={totalStages}
          />
        ),
      },
      {
        key: 'pending',
        label: 'На согласовании',
        children: (
          <RequestsTable
            requests={filteredCounterpartyPending}
            isLoading={isLoading}
            onView={setViewRecord}
            isCounterpartyUser
            hideCounterpartyColumn
            onWithdraw={handleWithdraw}
            uploadTasks={uploadTasks}
            onRetryUpload={retryTask}
            totalStages={totalStages}
          />
        ),
      },
      {
        key: 'approved',
        label: 'Согласовано',
        children: (
          <RequestsTable
            requests={filteredCounterpartyApproved}
            isLoading={isLoading}
            onView={setViewRecord}
            isCounterpartyUser
            hideCounterpartyColumn
            showApprovedDate
            uploadTasks={uploadTasks}
            onRetryUpload={retryTask}
            totalStages={totalStages}
          />
        ),
      },
      {
        key: 'rejected',
        label: 'Отклонено',
        children: (
          <RequestsTable
            requests={filteredCounterpartyRejected}
            isLoading={isLoading}
            onView={setViewRecord}
            isCounterpartyUser
            hideCounterpartyColumn
            showRejectedDate
            onResubmit={setResubmitRecord}
            uploadTasks={uploadTasks}
            onRetryUpload={retryTask}
            totalStages={totalStages}
          />
        ),
      },
    ]

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
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateOpen(true)}>
            Добавить
          </Button>
        </div>
        {filtersOpen && (
          <RequestFilters
            sites={sites}
            hideCounterpartyFilter={true}
            hideStatusFilter={true}
            showResponsibleFilter={false}
            values={filters}
            onChange={setFilters}
            onReset={() => setFilters({})}
          />
        )}
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={counterpartyTabItems} />
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

  // Формируем вкладки для admin/user
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
          onRetryUpload={retryTask}
          showResponsibleColumn={isOmtsUser || isAdmin}
          canAssignResponsible={false}
          omtsUsers={omtsUsers}
          onAssignResponsible={handleAssignResponsible}
          responsibleFilter={filters.responsibleFilter}
        />
      ),
    },
  ]

  // Вкладка "На согласование" — только если подразделение в цепочке или админ
  if (userDeptInChain) {
    tabItems.push({
      key: 'pending',
      label: `На согласование (${filteredPendingRequests.length})`,
      children: (
        <div>
          {/* Переключатель этапов для админа */}
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
          {/* Виджеты для вкладки "На согласование" */}
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
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateOpen(true)}>
          Добавить
        </Button>
      </div>
      {filtersOpen && (
        <RequestFilters
          counterparties={counterparties}
          sites={sites}
          hideCounterpartyFilter={false}
          hideStatusFilter={true}
          showResponsibleFilter={isOmtsUser || isAdmin}
          omtsUsers={omtsUsers}
          values={filters}
          onChange={setFilters}
          onReset={() => setFilters({})}
        />
      )}
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      <CreateRequestModal
        open={isCreateOpen}
        onClose={() => {
          setIsCreateOpen(false)
          const [sIds, allS] = siteFilterParams()
          if (isUser) {
            fetchRequests(undefined, sIds, allS)
          } else {
            fetchRequests()
          }
        }}
      />
      <ViewRequestModal
        open={!!viewRecord}
        request={viewRecord}
        onClose={() => setViewRecord(null)}
        canEdit={canEditRequest(viewRecord)}
        onEdit={handleEdit}
      />
    </div>
  )
}

export default PaymentRequestsPage
