import { Select } from 'antd'
import { wordFilter, type PayhubOption } from '@/utils/payhubLabels'

interface PayhubReferenceSelectProps {
  value: number | string | null | undefined
  options: PayhubOption[]
  disabled?: boolean
  placeholder?: string
  onChange: (value: number | string | undefined) => void
}

/** Инлайн-Select для сопоставления объекта с сущностью PayHub (проект/заказчик) */
export function PayhubReferenceSelect({
  value,
  options,
  disabled,
  placeholder,
  onChange,
}: PayhubReferenceSelectProps) {
  return (
    <Select
      style={{ width: '100%', minWidth: 180 }}
      size="small"
      value={value ?? undefined}
      options={options}
      onChange={(v) => onChange(v as number | string | undefined)}
      allowClear
      showSearch
      filterOption={wordFilter}
      placeholder={placeholder}
      disabled={disabled}
    />
  )
}
