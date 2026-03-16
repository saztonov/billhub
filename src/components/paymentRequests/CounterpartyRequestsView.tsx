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
  allCount: number
  pendingCount: number
  approvedCount: number
  rejectedCount: number
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
  totalInvoiceAmountAll: number
  totalPaidAll: number
  unreadCounts?: Record<string, number>
  isMobile?: boolean
}

/** UI заявок для роли counterparty_user */
const CounterpartyRequestsView = ({
  filteredAll,
  filteredPending,
  filteredApproved,
  filteredRejected,
  allCount,
  pendingCount,
  approvedCount,
  rejectedCount,
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
  totalInvoiceAmountAll,
  totalPaidAll,
  unreadCounts,
  isMobile,
}: CounterpartyRequestsViewProps) => {
  const setHeader = useHeaderStore((s) => s.setHeader)

  useEffect(() => {
    // На мобильном не показываем extra и actions в Header
    if (isMobile) {
      setHeader('Заявки на оплату', null, null)
      return
    }

    const extra = activeTab === 'all' ? (
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
    ) : null

    setHeader(
      'Заявки на оплату',
      extra,
      <Button type="primary" icon={<PlusOutlined />} onClick={onCreateOpen}>
        Добавить
      </Button>
    )
  }, [setHeader, onCreateOpen, activeTab, totalInvoiceAmountAll, totalPaidAll, isMobile])

  const tabItems = [
    {
      key: 'all',
      label: isMobile ? 'Все' : `Все (${allCount})`,
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
          unreadCounts={unreadCounts}
          isMobile={isMobile}
        />
      ),
    },
    {
      key: 'pending',
      label: isMobile ? 'Н.Сог' : `На согласовании (${pendingCount})`,
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
          requests={filteredApproved}
          isLoading={isLoading}
          onView={onView}
          isCounterpartyUser
          hideCounterpartyColumn
          showApprovedDate={!isMobile}
          uploadTasks={uploadTasks}
          totalStages={totalStages}
          unreadCounts={unreadCounts}
          isMobile={isMobile}
        />
      ),
    },
    {
      key: 'rejected',
      label: isMobile ? 'Откл.' : `Отклонено (${rejectedCount})`,
      children: (
        <RequestsTable
          requests={filteredRejected}
          isLoading={isLoading}
          onView={onView}
          isCounterpartyUser
          hideCounterpartyColumn
          showRejectedDate={!isMobile}
          onResubmit={onResubmit}
          uploadTasks={uploadTasks}
          totalStages={totalStages}
          unreadCounts={unreadCounts}
          isMobile={isMobile}
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
      size={isMobile ? 'small' : undefined}
      renderTabBar={(tabBarProps, DefaultTabBar) => (
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
            <DefaultTabBar {...tabBarProps} style={{ ...tabBarProps.style, flex: 1, marginBottom: 0 }} />
            {!isMobile && (
              <Button
                icon={<FilterOutlined />}
                onClick={onFiltersToggle}
                type={filtersOpen ? 'primary' : 'default'}
                size="small"
                style={{ flexShrink: 0 }}
              />
            )}
          </div>
        </div>
      )}
    />
    </div>
  )
}

export default CounterpartyRequestsView
