import { describe, it, expect } from 'vitest'
import {
  addCalendarDays,
  addWorkingDays,
  calculateDeliveryDate,
  formatDeliveryDate,
} from './dateCalculations'

describe('addCalendarDays', () => {
  it('добавляет указанное число календарных дней', () => {
    const start = new Date(2026, 0, 1) // 01.01.2026
    const result = addCalendarDays(start, 10)
    expect(result.getDate()).toBe(11)
    expect(result.getMonth()).toBe(0)
    expect(result.getFullYear()).toBe(2026)
  })

  it('не мутирует исходную дату', () => {
    const start = new Date(2026, 0, 1)
    const original = start.getTime()
    addCalendarDays(start, 5)
    expect(start.getTime()).toBe(original)
  })

  it('корректно обрабатывает переход через месяц', () => {
    const start = new Date(2026, 0, 28) // 28.01.2026
    const result = addCalendarDays(start, 5)
    expect(result.getDate()).toBe(2)
    expect(result.getMonth()).toBe(1) // февраль
  })

  it('добавление 0 дней возвращает ту же дату (новый объект)', () => {
    const start = new Date(2026, 5, 15)
    const result = addCalendarDays(start, 0)
    expect(result.getTime()).toBe(start.getTime())
    expect(result).not.toBe(start)
  })
})

describe('addWorkingDays', () => {
  it('добавляет 1 рабочий день в среду → четверг', () => {
    const wednesday = new Date(2026, 4, 27) // среда 27.05.2026
    const result = addWorkingDays(wednesday, 1)
    expect(result.getDay()).toBe(4) // четверг
    expect(result.getDate()).toBe(28)
  })

  it('пропускает выходные: +1 рабочий день в пятницу → понедельник', () => {
    const friday = new Date(2026, 4, 29) // пятница 29.05.2026
    const result = addWorkingDays(friday, 1)
    expect(result.getDay()).toBe(1) // понедельник
    expect(result.getDate()).toBe(1)
    expect(result.getMonth()).toBe(5) // июнь
  })

  it('+5 рабочих дней с понедельника → следующий понедельник', () => {
    const monday = new Date(2026, 5, 1) // понедельник 01.06.2026
    const result = addWorkingDays(monday, 5)
    expect(result.getDay()).toBe(1) // понедельник
    expect(result.getDate()).toBe(8)
  })

  it('+0 рабочих дней не сдвигает дату', () => {
    const monday = new Date(2026, 5, 1)
    const result = addWorkingDays(monday, 0)
    expect(result.getTime()).toBe(monday.getTime())
  })
})

describe('calculateDeliveryDate', () => {
  it('возвращает объект Date', () => {
    const result = calculateDeliveryDate(10, 'working')
    expect(result).toBeInstanceOf(Date)
  })

  it('working-режим даёт дату не раньше, чем calendar при одинаковом количестве дней', () => {
    const working = calculateDeliveryDate(10, 'working')
    const calendar = calculateDeliveryDate(10, 'calendar')
    // working с пропуском выходных → конечная дата позже или равна
    expect(working.getTime()).toBeGreaterThanOrEqual(calendar.getTime())
  })

  it('без includePaymentPeriod дата раньше, чем с ним', () => {
    const withPayment = calculateDeliveryDate(10, 'calendar', true)
    const withoutPayment = calculateDeliveryDate(10, 'calendar', false)
    expect(withoutPayment.getTime()).toBeLessThan(withPayment.getTime())
  })
})

describe('formatDeliveryDate', () => {
  it('форматирует среду 27.05.2026', () => {
    const date = new Date(2026, 4, 27)
    expect(formatDeliveryDate(date)).toBe('27.05.2026 (среда)')
  })

  it('форматирует воскресенье 31.05.2026', () => {
    const date = new Date(2026, 4, 31)
    expect(formatDeliveryDate(date)).toBe('31.05.2026 (воскресенье)')
  })

  it('паддит однозначный день и месяц нулями', () => {
    const date = new Date(2026, 0, 1) // 01.01.2026 — четверг
    expect(formatDeliveryDate(date)).toBe('01.01.2026 (четверг)')
  })
})
