/**
 * Утилиты для расчета дат поставки
 */

/**
 * Добавляет календарные дни к дате
 */
export function addCalendarDays(startDate: Date, days: number): Date {
  const result = new Date(startDate)
  result.setDate(result.getDate() + days)
  return result
}

/**
 * Добавляет рабочие дни (понедельник-пятница) к дате
 * Не учитывает праздники
 */
export function addWorkingDays(startDate: Date, days: number): Date {
  let currentDate = new Date(startDate)
  let remainingDays = days

  while (remainingDays > 0) {
    currentDate.setDate(currentDate.getDate() + 1)
    const dayOfWeek = currentDate.getDay()
    // 0 = воскресенье, 6 = суббота
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      remainingDays--
    }
  }

  return currentDate
}

/**
 * Рассчитывает ориентировочную дату поставки
 * Начало отсчета: следующий день после текущей даты
 * Этап 1: +3 рабочих дня (согласование СУ-10)
 * Этап 2: +14 календарных дней (оплата Заказчиком)
 * Этап 3: +deliveryDays (с учетом типа: working или calendar)
 */
export function calculateDeliveryDate(
  deliveryDays: number,
  deliveryDaysType: 'working' | 'calendar'
): Date {
  // Начинаем с завтрашнего дня
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)

  // Этап 1: +3 рабочих дня (согласование СУ-10)
  const afterApproval = addWorkingDays(tomorrow, 3)

  // Этап 2: +14 календарных дней (оплата)
  const afterPayment = addCalendarDays(afterApproval, 14)

  // Этап 3: +deliveryDays (с учетом типа)
  const finalDate =
    deliveryDaysType === 'working'
      ? addWorkingDays(afterPayment, deliveryDays)
      : addCalendarDays(afterPayment, deliveryDays)

  return finalDate
}

/**
 * Форматирует дату в читаемый вид: "дд.мм.гггг (день недели)"
 */
export function formatDeliveryDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()

  const weekdays = [
    'воскресенье',
    'понедельник',
    'вторник',
    'среда',
    'четверг',
    'пятница',
    'суббота',
  ]
  const weekday = weekdays[date.getDay()]

  return `${day}.${month}.${year} (${weekday})`
}
