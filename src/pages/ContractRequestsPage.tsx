import { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Switch, Flex, App } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api } from '@/services/api'
import { useHeaderStore } from '@/store/headerStore'
import useIsMobile from '@/hooks/useIsMobile'
import { useContractRequestsData } from '@/hooks/useContractRequestsData'
import { useContractRequestFiltering, type ContractFilterValues } from '@/hooks/useContractRequestFiltering'
import ContractRequestsTable from '@/components/contractRequests/ContractRequestsTable'
import ContractRequestFilters from '@/components/contractRequests/ContractRequestFilters'
import CreateContractRequestModal from '@/components/contractRequests/CreateContractRequestModal'
import ViewContractRequestModal from '@/components/contractRequests/ViewContractRequestModal'
import type { ContractRequest } from '@/types'

const FILTERS_KEY = 'billhub_contract_filters'

const ContractRequestsPage = () => {
  const { message } = App.useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const setHeader = useHeaderStore((s) => s.setHeader)
  const clearHeader = useHeaderStore((s) => s.clearHeader)

  // UI состояние
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [viewRecord, setViewRecord] = useState<ContractRequest | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)

  // Счётчики статусов для виджета в шапке
  const [statusCounts, setStatusCounts] = useState<{ approvOmts: number; onRevision: number; concluded: number } | null>(null)

  // Фильтры с сохранением в localStorage
  const [filters, setFiltersState] = useState<ContractFilterValues>(() => {
    try {
      const saved = localStorage.getItem(FILTERS_KEY)
      if (saved) return JSON.parse(saved) as ContractFilterValues
    } catch { /* ignore */ }
    return {}
  })

  const setFilters = useCallback((val: Partial<ContractFilterValues> | ((prev: ContractFilterValues) => ContractFilterValues)) => {
    setFiltersState((prev) => {
      const next = typeof val === 'function' ? val(prev) : { ...prev, ...val }
      try {
        // Сохраняем только непустые значения
        const toSave: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(next)) {
          if (v !== undefined && v !== null && v !== '') toSave[k] = v
        }
        if (Object.keys(toSave).length > 0) {
          localStorage.setItem(FILTERS_KEY, JSON.stringify(toSave))
        } else {
          localStorage.removeItem(FILTERS_KEY)
        }
      } catch { /* ignore */ }
      return next
    })
  }, [])

  // Данные
  const {
    isCounterpartyUser, isAdmin,
    requests, isLoading,
    counterparties, sites, suppliers, statuses,
    unreadCounts,
    loadRequests, deleteRequest,
  } = useContractRequestsData({ showDeleted })

  // Фильтрация
  const { filteredRequests } = useContractRequestFiltering({ requests, filters })

  // Загрузка счётчиков статусов (обновляются при изменении набора заявок)
  useEffect(() => {
    let cancelled = false
    api.get<{ approvOmts: number; onRevision: number; concluded: number }>('/api/contract-requests/status-counts')
      .then((data) => { if (!cancelled && data) setStatusCounts(data) })
      .catch(() => { /* счётчики некритичны для работы страницы */ })
    return () => { cancelled = true }
  }, [requests])

  // Открытие заявки по навигации (из уведомлений)
  useEffect(() => {
    const state = location.state as { openContractRequestId?: string } | null
    if (state?.openContractRequestId && requests.length > 0) {
      const found = requests.find((r) => r.id === state.openContractRequestId)
      if (found) {
        setViewRecord(found)
      }
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state, requests, navigate, location.pathname])

  // Заголовок страницы
  useEffect(() => {
    const actions = (
      <Flex gap={8} align="center">
        {isAdmin && (
          <Flex align="center" gap={4}>
            <Switch size="small" checked={showDeleted} onChange={setShowDeleted} />
            <span style={{ fontSize: 12 }}>Удалённые</span>
          </Flex>
        )}
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateOpen(true)}>
          {isMobile ? '' : 'Создать заявку'}
        </Button>
      </Flex>
    )

    // Виджет-счётчик статусов (только на десктопе)
    const extra = !isMobile && statusCounts ? (
      <div style={{ padding: '4px 12px', border: '1px solid #d9d9d9', borderRadius: 6, backgroundColor: '#fafafa', whiteSpace: 'nowrap', fontSize: 13 }}>
        <span style={{ color: '#8c8c8c', marginRight: 6 }}>Согласование ОМТС:</span>
        <span style={{ fontWeight: 500 }}>{statusCounts.approvOmts}</span>
        <span style={{ color: '#d9d9d9', margin: '0 8px' }}>|</span>
        <span style={{ color: '#8c8c8c', marginRight: 6 }}>На доработке:</span>
        <span style={{ fontWeight: 500 }}>{statusCounts.onRevision}</span>
        <span style={{ color: '#d9d9d9', margin: '0 8px' }}>|</span>
        <span style={{ color: '#8c8c8c', marginRight: 6 }}>Заключено:</span>
        <span style={{ fontWeight: 500 }}>{statusCounts.concluded}</span>
      </div>
    ) : null

    setHeader('Договора', extra, actions)
  }, [setHeader, isAdmin, showDeleted, isMobile, statusCounts])

  // Очистка заголовка при размонтировании
  useEffect(() => {
    return () => clearHeader()
  }, [clearHeader])

  // Обработчики
  const handleView = useCallback((record: ContractRequest) => {
    setViewRecord(record)
  }, [])

  const handleCreated = useCallback(() => {
    setIsCreateOpen(false)
    loadRequests()
    message.success('Заявка на договор создана')
  }, [loadRequests, message])

  const handleDelete = useCallback(async (id: string) => {
    await deleteRequest(id)
    message.success('Заявка удалена')
  }, [deleteRequest, message])

  const handleViewClose = useCallback(() => {
    setViewRecord(null)
    loadRequests()
  }, [loadRequests])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: isMobile ? 4 : 8 }}>
      <ContractRequestFilters
        values={filters}
        onChange={setFilters}
        counterparties={counterparties}
        sites={sites}
        suppliers={suppliers}
        statuses={statuses}
        hideCounterpartyFilter={isCounterpartyUser}
      />

      <ContractRequestsTable
        requests={filteredRequests}
        isLoading={isLoading}
        onView={handleView}
        onDelete={handleDelete}
        isAdmin={isAdmin}
        isCounterpartyUser={isCounterpartyUser}
        unreadCounts={unreadCounts}
      />

      <CreateContractRequestModal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={handleCreated}
      />

      {viewRecord && (
        <ViewContractRequestModal
          open={!!viewRecord}
          request={viewRecord}
          onClose={handleViewClose}
        />
      )}
    </div>
  )
}

export default ContractRequestsPage
