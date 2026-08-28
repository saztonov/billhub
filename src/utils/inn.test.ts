import { describe, it, expect } from 'vitest'
import { normalizeInn, isValidInn } from './inn'

describe('normalizeInn', () => {
  it('вырезает пробелы по краям и внутри', () => {
    expect(normalizeInn(' 7710 140679 ')).toBe('7710140679')
  })

  it('вырезает неразрывный пробел и табуляцию (копирование из PDF/письма)', () => {
    expect(normalizeInn('7710 140679')).toBe('7710140679')
    expect(normalizeInn('7710\t140679')).toBe('7710140679')
  })

  it('не трогает остальные символы', () => {
    expect(normalizeInn('ИНН 7710140679')).toBe('ИНН7710140679')
  })
})

describe('isValidInn', () => {
  it('принимает 10 и 12 цифр, в том числе с пробелами', () => {
    expect(isValidInn('7710140679')).toBe(true)
    expect(isValidInn('500100732259')).toBe(true)
    expect(isValidInn(' 7710 140679 ')).toBe(true)
  })

  it('отклоняет неверную длину и посторонние символы', () => {
    expect(isValidInn('123')).toBe(false)
    expect(isValidInn('77101406791')).toBe(false)
    expect(isValidInn('ИНН 7710140679')).toBe(false)
  })
})
