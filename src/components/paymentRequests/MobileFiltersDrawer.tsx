import { Drawer, Button } from 'antd'
import RequestFilters from './RequestFilters'
import type { FilterValues } from './RequestFilters'
import type { Counterparty, ConstructionSite, Status, Supplier } from '@/types'
import type { OmtsUser } from '@/store/assignmentStore'

interface MobileFiltersDrawerProps {
  open: boolean
  onClose: () => void
  counterparties?: Counterparty[]
  sites?: ConstructionSite[]
  statuses?: Status[]
  suppliers?: Supplier[]
  hideCounterpartyFilter?: boolean
  hideStatusFilter?: boolean
  hideSiteFilter?: boolean
  showResponsibleFilter?: boolean
  showMyRequestsFilter?: boolean
  omtsUsers?: OmtsUser[]
  values: FilterValues
  onChange: (values: FilterValues) => void
  onReset: () => void
}

const MobileFiltersDrawer = (props: MobileFiltersDrawerProps) => {
  const { open, onClose, values, onChange, onReset, ...filterProps } = props

  return (
    <Drawer
      title="Фильтры"
      placement="bottom"
      open={open}
      onClose={onClose}
      height="70vh"
      styles={{ body: { padding: '8px 12px', overflow: 'auto' } }}
      extra={
        <Button type="primary" onClick={onClose}>
          Применить
        </Button>
      }
    >
      <RequestFilters
        {...filterProps}
        values={values}
        onChange={onChange}
        onReset={() => {
          onReset()
          onClose()
        }}
      />
    </Drawer>
  )
}

export default MobileFiltersDrawer
