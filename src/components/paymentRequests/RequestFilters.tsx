import { Collapse, Form, Select, Input, Space, Button } from 'antd'
import { FilterOutlined } from '@ant-design/icons'
import type { Counterparty, ConstructionSite, Status } from '@/types'
import type { CollapseProps } from 'antd'

export interface FilterValues {
  counterpartyId?: string
  siteId?: string
  statusId?: string
  requestNumber?: string
  dateFrom?: string
  dateTo?: string
  responsibleFilter?: 'assigned' | 'unassigned' | null
}

interface RequestFiltersProps {
  counterparties?: Counterparty[]
  sites?: ConstructionSite[]
  statuses?: Status[]
  hideCounterpartyFilter?: boolean
  showResponsibleFilter?: boolean
  values: FilterValues
  onChange: (values: FilterValues) => void
  onReset: () => void
}

const RequestFilters = (props: RequestFiltersProps) => {
  const {
    counterparties,
    sites,
    statuses,
    hideCounterpartyFilter,
    showResponsibleFilter,
    values,
    onChange,
    onReset,
  } = props

  const [form] = Form.useForm()

  const handleValuesChange = (_: any, allValues: any) => {
    onChange(allValues)
  }

  const handleReset = () => {
    form.resetFields()
    onReset()
  }

  const items: CollapseProps['items'] = [
    {
      key: '1',
      label: (
        <Space>
          <FilterOutlined />
          <span>Фильтры</span>
        </Space>
      ),
      children: (
        <Form
          form={form}
          layout="vertical"
          initialValues={values}
          onValuesChange={handleValuesChange}
        >
          <Space size="large" wrap>
            {!hideCounterpartyFilter && (
              <Form.Item label="Подрядчик" name="counterpartyId" style={{ marginBottom: 0, width: 250 }}>
                <Select
                  placeholder="Все"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={counterparties?.map((c) => ({
                    label: c.name,
                    value: c.id,
                  }))}
                />
              </Form.Item>
            )}

            <Form.Item label="Объект" name="siteId" style={{ marginBottom: 0, width: 250 }}>
              <Select
                placeholder="Все"
                allowClear
                showSearch
                optionFilterProp="label"
                options={sites?.map((s) => ({
                  label: s.name,
                  value: s.id,
                }))}
              />
            </Form.Item>

            <Form.Item label="Статус" name="statusId" style={{ marginBottom: 0, width: 200 }}>
              <Select
                placeholder="Все"
                allowClear
                options={statuses?.map((s) => ({
                  label: s.name,
                  value: s.id,
                }))}
              />
            </Form.Item>

            {showResponsibleFilter && (
              <Form.Item label="Ответственный" name="responsibleFilter" style={{ marginBottom: 0, width: 180 }}>
                <Select
                  placeholder="Все"
                  allowClear
                  options={[
                    { label: 'Назначен', value: 'assigned' },
                    { label: 'Не назначен', value: 'unassigned' },
                  ]}
                />
              </Form.Item>
            )}

            <Form.Item label="Номер заявки" name="requestNumber" style={{ marginBottom: 0, width: 180 }}>
              <Input placeholder="Поиск по номеру" allowClear />
            </Form.Item>

            <Form.Item label="Дата от" name="dateFrom" style={{ marginBottom: 0, width: 140 }}>
              <Input type="date" />
            </Form.Item>

            <Form.Item label="Дата до" name="dateTo" style={{ marginBottom: 0, width: 140 }}>
              <Input type="date" />
            </Form.Item>

            <Form.Item label=" " colon={false} style={{ marginBottom: 0 }}>
              <Button onClick={handleReset}>Сбросить</Button>
            </Form.Item>
          </Space>
        </Form>
      ),
    },
  ]

  return (
    <Collapse
      ghost
      defaultActiveKey={['1']}
      items={items}
      style={{ marginBottom: 16, background: '#fafafa', borderRadius: 8 }}
    />
  )
}

export default RequestFilters
