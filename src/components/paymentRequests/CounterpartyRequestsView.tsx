import { useEffect } from 'react'
import { Button, Tabs } from 'antd'
import { PlusOutlined, FilterOutlined } from '@ant-design/icons'
import { useHeaderStore } from '@/store/headerStore'
import RequestsTable from './RequestsTable'
import RequestFilters from './RequestFilters'
import type { FilterValues } from './RequestFilters'
import type { PaymentRequest, ConstructionSite, Status, Supplier } from '@/types'
import type { UploadTask } from '@/store/uploadQueueStore'

interface CounterpartyRequestsViewProps {
  filteredAll: PaymentRequest[]
  filteredPending: PaymentRequest[]
  filteredApproved: PaymentRequest[]
  filteredRejected: PaymentRequest[]
  isLoading: boolean
  sites: ConstructionSite[]
  statuses: Status[]
  suppliers: Supplier[]
  filters: FilterValues
  onFiltersChange: (filters: FilterValues) => void
  filtersOpen: boolean
  onFiltersToggle: () => void
  activeTab: string
  onTabChange: (key: string) => void
  onTabClick: (key: string) => void
  onView: (record: PaymentRequest) => void
  onWithdraw: (id: string, comment: string) => Promise<void>
  onResubmit: (record: PaymentRequest) => void
  onCreateOpen: () => void
  uploadTasks: Record<string, UploadTask>
  totalStages: number
}

/** UI заявок для роли counterparty_user */
const CounterpartyRequestsView = ({
  filteredAll,
  filteredPending,
  filteredApproved,
  filteredRejected,
  isLoading,
  sites,
  statuses,
  suppliers,
  filters,
  onFiltersChange,
  filtersOpen,
  onFiltersToggle,
  activeTab,
  onTabChange,
  onTabClick,
  onView,
  onWithdraw,
  onResubmit,
  onCreateOpen,
  uploadTasks,
  totalStages,
}: CounterpartyRequestsViewProps) => {
  const setHeader = useHeaderStore((s) => s.setHeader)

  useEffect(() => {
    setHeader(
      'Заявки на оплату',
      null,
      <Button type="primary" icon={<PlusOutlined />} onClick={onCreateOpen}>
        Добавить
      </Button>
    )
  }, [setHeader, onCreateOpen])

  const tabItems = [
    {
      key: 'all',
      label: 'Все',
      children: (
        <RequestsTable
          requests={filteredAll}
          isLoading={isLoading}
          onView={onView}
          isCounterpartyUser
          hideCounterpartyColumn
          onWithdraw={onWithdraw}
          onResubmit={onResubmit}
          uploadTasks={uploadTasks}
          totalStages={totalStages}
        />
      ),
    },
    {
      key: 'pending',
      label: 'На согласовании',
      children: (
        <RequestsTable
          requests={filteredPending}
          isLoading={isLoading}
          onView={onView}
          isCounterpartyUser
          hideCounterpartyColumn
          onWithdraw={onWithdraw}
          uploadTasks={uploadTasks}
          totalStages={totalStages}
        />
      ),
    },
    {
      key: 'approved',
      label: 'Согласовано',
      children: (
        <RequestsTable
          requests={filteredApproved}
          isLoading={isLoading}
          onView={onView}
          isCounterpartyUser
          hideCounterpartyColumn
          showApprovedDate
          uploadTasks={uploadTasks}
          totalStages={totalStages}
        />
      ),
    },
    {
      key: 'rejected',
      label: 'Отклонено',
      children: (
        <RequestsTable
          requests={filteredRejected}
          isLoading={isLoading}
          onView={onView}
          isCounterpartyUser
          hideCounterpartyColumn
          showRejectedDate
          onResubmit={onResubmit}
          uploadTasks={uploadTasks}
          totalStages={totalStages}
        />
      ),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <Tabs
      activeKey={activeTab}
      onChange={onTabChange}
      onTabClick={onTabClick}
      items={tabItems}
      className="flex-tabs"
      renderTabBar={(props, DefaultTabBar) => (
        <div>
          {filtersOpen && (
            <RequestFilters
              sites={sites}
              statuses={statuses}
              suppliers={suppliers}
              hideCounterpartyFilter={true}
              hideStatusFilter={activeTab !== 'all'}
              showResponsibleFilter={false}
              values={filters}
              onChange={onFiltersChange}
              onReset={() => onFiltersChange({})}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DefaultTabBar {...props} style={{ ...props.style, flex: 1, marginBottom: 0 }} />
            <Button
              icon={<FilterOutlined />}
              onClick={onFiltersToggle}
              type={filtersOpen ? 'primary' : 'default'}
              size="small"
              style={{ flexShrink: 0 }}
            />
          </div>
        </div>
      )}
    />
    </div>
  )
}

export default CounterpartyRequestsView
