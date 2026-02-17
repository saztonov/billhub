import { useState } from 'react'
import { Collapse, Alert } from 'antd'
import type { CollapseProps } from 'antd'
import { calculateDeliveryDate, formatDeliveryDate } from '@/utils/dateCalculations'

// UUID условия отгрузки "Отсрочка"
const DEFERRED_CONDITION_ID = '78569b50-8670-4012-a791-bf8a5f823939'

interface DeliveryCalculationProps {
  deliveryDays: number | null
  deliveryDaysType: 'working' | 'calendar'
  shippingConditionId?: string | null
  defaultExpanded?: boolean
}

/**
 * Компонент отображения расчета ориентировочного срока поставки
 * Сворачиваемый блок с кратким отображением в заголовке
 */
const DeliveryCalculation = ({ deliveryDays, deliveryDaysType, shippingConditionId, defaultExpanded = true }: DeliveryCalculationProps) => {
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

  // При "Отсрочке" этап оплаты не учитывается
  const includePayment = shippingConditionId !== DEFERRED_CONDITION_ID

  const deliveryDate = calculateDeliveryDate(deliveryDays, deliveryDaysType, includePayment)
  const formattedDate = formatDeliveryDate(deliveryDate)
  const daysTypeLabel = deliveryDaysType === 'working' ? 'рабочих' : 'календарных'

  const items: CollapseProps['items'] = [
    {
      key: '1',
      label: `Ориентировочный срок поставки: ${formattedDate}`,
      children: (
        <div>
          <div>• Время согласования СУ-10: 3 рабочих дня</div>
          {includePayment && <div>• Время оплаты Заказчиком: 2 недели</div>}
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
