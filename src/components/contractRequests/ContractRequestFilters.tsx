import { useEffect, useMemo } from 'react'
import { Form, Select, Input, DatePicker, Space, Button } from 'antd'
import { ClearOutlined } from '@ant-design/icons'
import type { Counterparty, ConstructionSite, Supplier, Status } from '@/types'
import type { ContractFilterValues } from '@/hooks/useContractRequestFiltering'
import dayjs from 'dayjs'
import useIsMobile from '@/hooks/useIsMobile'

const { RangePicker } = DatePicker

interface ContractRequestFiltersProps {
  values: ContractFilterValues
  onChange: (values: Partial<ContractFilterValues>) => void
  counterparties: Counterparty[]
  sites: ConstructionSite[]
  suppliers: Supplier[]
  statuses: Status[]
  hideCounterpartyFilter?: boolean
}

const ContractRequestFilters = ({
  values,
  onChange,
  counterparties,
  sites,
  suppliers,
  statuses,
  hideCounterpartyFilter = false,
}: ContractRequestFiltersProps) => {
  const [form] = Form.useForm()
  const isMobile = useIsMobile()

  // Синхронизация значений формы при внешнем изменении
  useEffect(() => {
    const formValues: Record<string, unknown> = { ...values }
    if (values.dateFrom && values.dateTo) {
      formValues.dateRange = [dayjs(values.dateFrom), dayjs(values.dateTo)]
    } else if (values.dateFrom) {
      formValues.dateRange = [dayjs(values.dateFrom), null]
    } else if (values.dateTo) {
      formValues.dateRange = [null, dayjs(values.dateTo)]
    } else {
      formValues.dateRange = undefined
    }
    delete formValues.dateFrom
    delete formValues.dateTo
    form.setFieldsValue(formValues)
  }, [values, form])

  // Опции для селектов
  const counterpartyOptions = useMemo(() =>
    counterparties
      .filter((c) => c.isActive !== false)
      .map((c) => ({ label: c.name, value: c.id })),
    [counterparties]
  )

  const siteOptions = useMemo(() =>
    sites
      .filter((s) => s.isActive)
      .map((s) => ({ label: s.name, value: s.id })),
    [sites]
  )

  const supplierOptions = useMemo(() =>
    suppliers.map((s) => ({ label: s.name, value: s.id })),
    [suppliers]
  )

  const statusOptions = useMemo(() =>
    statuses
      .filter((s) => s.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((s) => ({ label: s.name, value: s.id })),
    [statuses]
  )

  // Обработка изменений полей формы
  const handleValuesChange = (changedValues: Record<string, unknown>) => {
    const { dateRange, ...rest } = changedValues
    const transformed: Partial<ContractFilterValues> = { ...rest }
    if ('dateRange' in changedValues) {
      const range = dateRange as [dayjs.Dayjs, dayjs.Dayjs] | null | undefined
      transformed.dateFrom = range?.[0]?.format('YYYY-MM-DD')
      transformed.dateTo = range?.[1]?.format('YYYY-MM-DD')
    }
    onChange(transformed)
  }

  // Сброс фильтров
  const handleReset = () => {
    form.resetFields()
    onChange({
      counterpartyId: undefined,
      siteId: undefined,
      supplierId: undefined,
      statusId: undefined,
      requestNumber: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    })
  }

  const hasActiveFilters = Object.values(values).some((v) => v !== undefined && v !== '')

  return (
    <div style={{ marginBottom: isMobile ? 4 : 8, background: '#fafafa', borderRadius: 8, padding: '8px 12px' }}>
      <Form
        form={form}
        layout="vertical"
        size="small"
        onValuesChange={handleValuesChange}
      >
        <Space size="middle" wrap>
          {!hideCounterpartyFilter && (
            <Form.Item
              label="Подрядчик"
              name="counterpartyId"
              style={{ marginBottom: 0, width: isMobile ? '100%' : 170 }}
            >
              <Select
                placeholder="Все"
                allowClear
                showSearch
                optionFilterProp="label"
                popupMatchSelectWidth={false}
                options={counterpartyOptions}
              />
            </Form.Item>
          )}
          <Form.Item
            label="Объект"
            name="siteId"
            style={{ marginBottom: 0, width: isMobile ? '100%' : 170 }}
          >
            <Select
              placeholder="Все"
              allowClear
              showSearch
              optionFilterProp="label"
              popupMatchSelectWidth={false}
              options={siteOptions}
            />
          </Form.Item>
          <Form.Item
            label="Поставщик"
            name="supplierId"
            style={{ marginBottom: 0, width: isMobile ? '100%' : 170 }}
          >
            <Select
              placeholder="Все"
              allowClear
              showSearch
              optionFilterProp="label"
              popupMatchSelectWidth={false}
              options={supplierOptions}
            />
          </Form.Item>
          <Form.Item
            label="Статус"
            name="statusId"
            style={{ marginBottom: 0, width: isMobile ? '100%' : 150 }}
          >
            <Select
              placeholder="Все"
              allowClear
              popupMatchSelectWidth={false}
              options={statusOptions}
            />
          </Form.Item>
          <Form.Item
            label="Номер"
            name="requestNumber"
            style={{ marginBottom: 0, width: isMobile ? '100%' : 140 }}
          >
            <Input placeholder="По номеру" allowClear />
          </Form.Item>
          <Form.Item
            label="Диапазон дат"
            name="dateRange"
            style={{ marginBottom: 0, width: isMobile ? '100%' : 220 }}
          >
            <RangePicker
              format="DD.MM.YYYY"
              placeholder={['Дата от', 'Дата до']}
              style={{ width: '100%' }}
            />
          </Form.Item>
          {hasActiveFilters && (
            <Form.Item label=" " colon={false} style={{ marginBottom: 0 }}>
              <Button icon={<ClearOutlined />} onClick={handleReset}>
                Сбросить
              </Button>
            </Form.Item>
          )}
        </Space>
      </Form>
    </div>
  )
}

export default ContractRequestFilters
