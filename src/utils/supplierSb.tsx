import type { ReactNode } from 'react'
import { Tag } from 'antd'
import type { Supplier } from '@/types'

/** Стиль зачёркивания отклонённого СБ поставщика */
export const SB_REJECTED_STRIKE_STYLE: React.CSSProperties = {
  textDecoration: 'line-through',
  color: '#ff4d4f',
}

/** Подпись-тег «СБ» рядом с отклонённым поставщиком */
export function renderSbBadge(): ReactNode {
  return (
    <Tag color="red" style={{ marginInlineStart: 6, marginInlineEnd: 0 }}>
      СБ
    </Tag>
  )
}

/** Опция поставщика для Select с пометкой отклонения СБ */
export interface SupplierOption {
  label: string
  value: string
  disabled: boolean
  rejected: boolean
}

/** Построить опции поставщиков: отклонённые СБ становятся disabled и помечаются флагом */
export function buildSupplierOptions(suppliers: Supplier[]): SupplierOption[] {
  return suppliers.map((s) => {
    const rejected = s.lastSecurityStatus === 'rejected'
    return {
      label: s.inn ? `${s.name}, ${s.inn}` : s.name,
      value: s.id,
      disabled: rejected,
      rejected,
    }
  })
}

/** Рендер опции поставщика в выпадающем списке (зачёркивание + «СБ» для отклонённых) */
export function renderSupplierOption(
  option: { label?: ReactNode; data?: { rejected?: boolean; label?: string } },
): ReactNode {
  const label = option.data?.label ?? option.label
  if (!option.data?.rejected) return label
  return (
    <span>
      <span style={SB_REJECTED_STRIKE_STYLE}>{label}</span>
      {renderSbBadge()}
    </span>
  )
}
