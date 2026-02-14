import { Alert } from 'antd'
import { calculateDeliveryDate, formatDeliveryDate } from '@/utils/dateCalculations'

interface DeliveryCalculationProps {
  deliveryDays: number | null
  deliveryDaysType: 'working' | 'calendar'
}

/**
 * Компонент отображения расчета ориентировочного срока поставки
 */
const DeliveryCalculation = ({ deliveryDays, deliveryDaysType }: DeliveryCalculationProps) => {
  if (!deliveryDays) {
    return (
      <Alert
        type="info"
        message="Укажите срок поставки для расчета ориентировочной даты"
        style={{ marginBottom: 16 }}
      />
    )
  }

  const deliveryDate = calculateDeliveryDate(deliveryDays, deliveryDaysType)
  const formattedDate = formatDeliveryDate(deliveryDate)
  const daysTypeLabel = deliveryDaysType === 'working' ? 'рабочих' : 'календарных'

  return (
    <Alert
      type="info"
      message="Расчет срока поставки"
      description={
        <div>
          <div>• Время согласования СУ-10: 3 рабочих дня</div>
          <div>• Время оплаты Заказчиком: 2 недели</div>
          <div>
            • Время поставки: {deliveryDays} {daysTypeLabel} дн.
          </div>
          <div style={{ marginTop: 8, fontWeight: 'bold' }}>
            Ориентировочный срок поставки: {formattedDate}
          </div>
        </div>
      }
      style={{ marginTop: 8, marginBottom: 16 }}
    />
  )
}

export default DeliveryCalculation
