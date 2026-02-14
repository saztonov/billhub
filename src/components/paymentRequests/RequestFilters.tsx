import { Form, Select, Input, Space, Button, DatePicker } from 'antd'
import type { Counterparty, ConstructionSite, Status } from '@/types'
import dayjs from 'dayjs'

const { RangePicker } = DatePicker

export interface FilterValues {
  counterpartyId?: string
  siteId?: string
  statusId?: string
  requestNumber?: string
  dateFrom?: string
  dateTo?: string
  responsibleFilter?: 'assigned' | 'unassigned' | null
  responsibleUserId?: string
}

interface RequestFiltersProps {
  counterparties?: Counterparty[]
  sites?: ConstructionSite[]
  statuses?: Status[]
  hideCounterpartyFilter?: boolean
  showResponsibleFilter?: boolean
  omtsUsers?: OmtsUser[]
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
    omtsUsers,
    values,
    onChange,
    onReset,
  } = props

  const [form] = Form.useForm()

  // Преобразуем dateFrom/dateTo в dateRange для отображения в форме
  const initialValues = {
    ...values,
    dateRange:
      values.dateFrom && values.dateTo
        ? [dayjs(values.dateFrom), dayjs(values.dateTo)]
        : values.dateFrom
        ? [dayjs(values.dateFrom), null]
        : values.dateTo
        ? [null, dayjs(values.dateTo)]
        : undefined,
  }

  const handleValuesChange = (_: any, allValues: any) => {
    // Преобразуем dateRange в dateFrom/dateTo для родительского компонента
    const { dateRange, ...rest } = allValues
    const transformed = {
      ...rest,
      dateFrom: dateRange?.[0] ? dateRange[0].format('YYYY-MM-DD') : undefined,
      dateTo: dateRange?.[1] ? dateRange[1].format('YYYY-MM-DD') : undefined,
    }
    onChange(transformed)
  }

  const handleReset = () => {
    form.resetFields()
    onReset()
  }

  return (
    <div style={{ marginBottom: 16, background: '#fafafa', borderRadius: 8, padding: 16 }}>
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
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

          {showResponsibleFilter && omtsUsers && omtsUsers.length > 0 && (
            <Form.Item label="Пользователь ОМТС" name="responsibleUserId" style={{ marginBottom: 0, width: 220 }}>
              <Select
                placeholder="Все"
                allowClear
                showSearch
                optionFilterProp="label"
                options={omtsUsers.map((u) => ({
                  label: u.full_name || u.email,
                  value: u.id,
                }))}
              />
            </Form.Item>
          )}

          <Form.Item label="Номер заявки" name="requestNumber" style={{ marginBottom: 0, width: 180 }}>
            <Input placeholder="Поиск по номеру" allowClear />
          </Form.Item>

          <Form.Item label="Диапазон дат" name="dateRange" style={{ marginBottom: 0, width: 250 }}>
            <RangePicker
              format="DD.MM.YYYY"
              placeholder={['Дата от', 'Дата до']}
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item label=" " colon={false} style={{ marginBottom: 0 }}>
            <Button onClick={handleReset}>Сбросить</Button>
          </Form.Item>
        </Space>
      </Form>
    </div>
  )
}

export default RequestFilters
