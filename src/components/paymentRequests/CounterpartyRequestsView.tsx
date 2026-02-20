import { Typography, Button, Tabs } from 'antd'
import { PlusOutlined, FilterOutlined } from '@ant-design/icons'
import RequestsTable from './RequestsTable'
import RequestFilters from './RequestFilters'
import type { FilterValues } from './RequestFilters'
import type { PaymentRequest, ConstructionSite } from '@/types'
import type { UploadTask } from '@/store/uploadQueueStore'

const { Title } = Typography

interface CounterpartyRequestsViewProps {
  filteredAll: PaymentRequest[]
  filteredPending: PaymentRequest[]
  filteredApproved: PaymentRequest[]
  filteredRejected: PaymentRequest[]
  isLoading: boolean
  sites: ConstructionSite[]
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
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Title level={2} style={{ margin: 0 }}>Заявки на оплату</Title>
          <Button
            icon={<FilterOutlined />}
            onClick={onFiltersToggle}
            type={filtersOpen ? 'primary' : 'default'}
          />
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreateOpen}>
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
          onChange={onFiltersChange}
          onReset={() => onFiltersChange({})}
        />
      )}
      <Tabs activeKey={activeTab} onChange={onTabChange} onTabClick={onTabClick} items={tabItems} />
    </>
  )
}

export default CounterpartyRequestsView
