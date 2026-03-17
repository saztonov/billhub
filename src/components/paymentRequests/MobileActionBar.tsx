import { Button, Badge, Flex } from 'antd'
import { PlusOutlined, FilterOutlined, FileExcelOutlined } from '@ant-design/icons'
import type { FilterValues } from './RequestFilters'

interface MobileActionBarProps {
  onAdd: () => void
  onFilterToggle: () => void
  filters: FilterValues
  onExport?: () => void
}

/** Подсчёт активных фильтров */
function countActiveFilters(filters: FilterValues): number {
  let count = 0
  if (filters.counterpartyId) count++
  if (filters.siteId) count++
  if (filters.statusId) count++
  if (filters.supplierId) count++
  if (filters.requestNumber) count++
  if (filters.dateFrom || filters.dateTo) count++
  if (filters.responsibleFilter) count++
  if (filters.responsibleUserId) count++
  if (filters.myRequestsFilter && filters.myRequestsFilter !== 'all') count++
  if (filters.amountValue != null) count++
  return count
}

const MobileActionBar = (props: MobileActionBarProps) => {
  const { onAdd, onFilterToggle, filters, onExport } = props
  const activeCount = countActiveFilters(filters)

  return (
    <Flex
      gap={8}
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '8px 12px',
        background: '#fff',
        borderTop: '1px solid #f0f0f0',
        zIndex: 10,
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
      }}
    >
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={onAdd}
        style={{ flex: 1 }}
      >
        Добавить
      </Button>
      {onExport && (
        <Button
          icon={<FileExcelOutlined />}
          onClick={onExport}
          style={{ borderColor: '#52c41a', color: '#52c41a' }}
        >
          Реестр
        </Button>
      )}
      <Badge count={activeCount} size="small">
        <Button
          icon={<FilterOutlined />}
          onClick={onFilterToggle}
          type={activeCount > 0 ? 'primary' : 'default'}
          ghost={activeCount > 0}
        >
          Фильтры
        </Button>
      </Badge>
    </Flex>
  )
}

export default MobileActionBar
