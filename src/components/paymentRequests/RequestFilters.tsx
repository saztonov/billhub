import { useEffect } from 'react'
import { Form, Select, Input, InputNumber, Space, Button, DatePicker } from 'antd'
import type { Counterparty, ConstructionSite, Status, Supplier } from '@/types'
import type { OmtsUser } from '@/store/assignmentStore'
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
  myRequestsFilter?: 'all' | 'assigned_to_me'
  supplierId?: string
  amountOperator?: '>=' | '<=' | '='
  amountValue?: number
}

interface RequestFiltersProps {
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

const RequestFilters = (props: RequestFiltersProps) => {
  const {
    counterparties,
    sites,
    statuses,
    suppliers,
    hideCounterpartyFilter,
    hideStatusFilter,
    hideSiteFilter,
    showResponsibleFilter,
    showMyRequestsFilter,
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

  const handleValuesChange = (changedValues: any) => {
    // Передаём только изменённые поля — мерж с предыдущими в setFilters
    const { dateRange, ...rest } = changedValues
    const transformed: Record<string, any> = { ...rest }
    if ('dateRange' in changedValues) {
      transformed.dateFrom = dateRange?.[0] ? dateRange[0].format('YYYY-MM-DD') : undefined
      transformed.dateTo = dateRange?.[1] ? dateRange[1].format('YYYY-MM-DD') : undefined
    }
    onChange(transformed as FilterValues)
  }

  // Синхронизация формы при внешнем изменении values (сброс к дефолтным)
  useEffect(() => {
    form.setFieldsValue({
      ...values,
      dateRange:
        values.dateFrom && values.dateTo
          ? [dayjs(values.dateFrom), dayjs(values.dateTo)]
          : values.dateFrom
          ? [dayjs(values.dateFrom), null]
          : values.dateTo
          ? [null, dayjs(values.dateTo)]
          : undefined,
    })
  }, [values, form, showResponsibleFilter, showMyRequestsFilter])

  const handleReset = () => {
    form.resetFields()
    onReset()
  }

  return (
    <div style={{ marginBottom: 8, background: '#fafafa', borderRadius: 8, padding: '8px 12px' }}>
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onValuesChange={handleValuesChange}
        size="small"
      >
        <Space size="middle" wrap>
          {!hideCounterpartyFilter && (
            <Form.Item label="Подрядчик" name="counterpartyId" style={{ marginBottom: 0, width: 170 }}>
              <Select
                placeholder="Все"
                allowClear
                showSearch
                optionFilterProp="label"
                popupMatchSelectWidth={false}
                options={counterparties?.map((c) => ({
                  label: c.name,
                  value: c.id,
                }))}
              />
            </Form.Item>
          )}

          {!hideSiteFilter && (
            <Form.Item label="Объект" name="siteId" style={{ marginBottom: 0, width: 170 }}>
              <Select
                placeholder="Все"
                allowClear
                showSearch
                optionFilterProp="label"
                popupMatchSelectWidth={false}
                options={sites?.map((s) => ({
                  label: s.name,
                  value: s.id,
                }))}
              />
            </Form.Item>
          )}

          <Form.Item label="Поставщик" name="supplierId" style={{ marginBottom: 0, width: 170 }}>
            <Select
              placeholder="Все"
              allowClear
              showSearch
              optionFilterProp="label"
              popupMatchSelectWidth={false}
              options={suppliers?.map((s) => ({
                label: s.name,
                value: s.id,
              }))}
            />
          </Form.Item>

          {!hideStatusFilter && (
            <Form.Item label="Статус" name="statusId" style={{ marginBottom: 0, width: 150 }}>
              <Select
                placeholder="Все"
                allowClear
                popupMatchSelectWidth={false}
                options={statuses?.filter((s) => s.isActive).map((s) => ({
                  label: s.name,
                  value: s.id,
                }))}
              />
            </Form.Item>
          )}

          {showResponsibleFilter && (
            <Form.Item label="Ответственный" name="responsibleFilter" style={{ marginBottom: 0, width: 150 }}>
              <Select
                placeholder="Все"
                allowClear
                popupMatchSelectWidth={false}
                options={[
                  { label: 'Назначен', value: 'assigned' },
                  { label: 'Не назначен', value: 'unassigned' },
                ]}
              />
            </Form.Item>
          )}

          {showResponsibleFilter && omtsUsers && omtsUsers.length > 0 && (
            <Form.Item label="Ответственный ОМТС" name="responsibleUserId" style={{ marginBottom: 0, width: 180 }}>
              <Select
                placeholder="Все"
                allowClear
                showSearch
                optionFilterProp="label"
                popupMatchSelectWidth={false}
                options={omtsUsers.map((u) => ({
                  label: u.fullName || u.email,
                  value: u.id,
                }))}
              />
            </Form.Item>
          )}

          {showMyRequestsFilter && (
            <Form.Item label="Заявки" name="myRequestsFilter" style={{ marginBottom: 0, width: 160 }}>
              <Select
                popupMatchSelectWidth={false}
                options={[
                  { label: 'Все', value: 'all' },
                  { label: 'Назначенные мне', value: 'assigned_to_me' },
                ]}
              />
            </Form.Item>
          )}

          <Form.Item label="Сумма РП" style={{ marginBottom: 0 }}>
            <Space.Compact>
              <Form.Item name="amountOperator" noStyle>
                <Select
                  placeholder="="
                  style={{ width: 60 }}
                  allowClear
                  options={[
                    { label: '>=', value: '>=' },
                    { label: '<=', value: '<=' },
                    { label: '=', value: '=' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="amountValue" noStyle>
                <InputNumber
                  placeholder="Сумма"
                  style={{ width: 110 }}
                  min={0}
                  controls={false}
                />
              </Form.Item>
            </Space.Compact>
          </Form.Item>

          <Form.Item label="Номер заявки" name="requestNumber" style={{ marginBottom: 0, width: 140 }}>
            <Input placeholder="По номеру" allowClear />
          </Form.Item>

          <Form.Item label="Диапазон дат" name="dateRange" style={{ marginBottom: 0, width: 220 }}>
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
