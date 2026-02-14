import { useState } from 'react'
import { Collapse, Alert } from 'antd'
import type { CollapseProps } from 'antd'
import { calculateDeliveryDate, formatDeliveryDate } from '@/utils/dateCalculations'

interface DeliveryCalculationProps {
  deliveryDays: number | null
  deliveryDaysType: 'working' | 'calendar'
  defaultExpanded?: boolean
}

/**
 * Компонент отображения расчета ориентировочного срока поставки
 * Сворачиваемый блок с кратким отображением в заголовке
 */
const DeliveryCalculation = ({ deliveryDays, deliveryDaysType, defaultExpanded = true }: DeliveryCalculationProps) => {
  const [activeKey, setActiveKey] = useState<string | string[]>(defaultExpanded ? ['1'] : [])

  if (!deliveryDays) {
    return (
      <Alert
        type="info"
        title="Укажите срок поставки для расчета ориентировочной даты"
        style={{ marginBottom: 16 }}
      />
    )
  }

  const deliveryDate = calculateDeliveryDate(deliveryDays, deliveryDaysType)
  const formattedDate = formatDeliveryDate(deliveryDate)
  const daysTypeLabel = deliveryDaysType === 'working' ? 'рабочих' : 'календарных'

  const items: CollapseProps['items'] = [
    {
      key: '1',
      label: `Ориентировочный срок поставки: ${formattedDate}`,
      children: (
        <div>
          <div>• Время согласования СУ-10: 3 рабочих дня</div>
          <div>• Время оплаты Заказчиком: 2 недели</div>
          <div>
            • Время поставки: {deliveryDays} {daysTypeLabel} дн.
          </div>
          <div style={{ marginTop: 8, fontWeight: 'bold' }}>
            Итого: {formattedDate}
          </div>
        </div>
      ),
    },
  ]

  return (
    <Collapse
      items={items}
      activeKey={activeKey}
      onChange={setActiveKey}
      style={{ marginTop: 8, marginBottom: 16, background: '#e6f4ff' }}
    />
  )
}

export default DeliveryCalculation
