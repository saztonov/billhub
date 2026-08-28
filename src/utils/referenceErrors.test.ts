import { describe, it, expect } from 'vitest'
import { ApiError } from '@/services/api'
import { describeReferenceError, isInnFieldError } from './referenceErrors'

const innValidationError = new ApiError(400, 'Ошибка валидации', {
  error: 'Ошибка валидации',
  details: [{ path: ['inn'], message: 'ИНН должен содержать 10 или 12 цифр' }],
})

describe('describeReferenceError', () => {
  it('409 — понятный текст про дубль ИНН', () => {
    const err = new ApiError(409, 'Supplier with inn already exists')
    expect(describeReferenceError(err, 'Поставщик')).toBe(
      'Поставщик с таким ИНН уже есть в справочнике',
    )
    expect(describeReferenceError(err, 'Подрядчик')).toBe(
      'Подрядчик с таким ИНН уже есть в справочнике',
    )
  })

  it('400 по полю ИНН — текст про формат вместо «Ошибка валидации»', () => {
    expect(describeReferenceError(innValidationError, 'Поставщик')).toBe(
      'ИНН должен содержать 10 или 12 цифр, без лишних символов',
    )
  })

  it('прочие ошибки отдают сообщение как есть', () => {
    expect(describeReferenceError(new ApiError(0, 'Ошибка сети'), 'Поставщик')).toBe('Ошибка сети')
    expect(describeReferenceError(new Error('Сбой'), 'Поставщик')).toBe('Сбой')
    expect(describeReferenceError('строка', 'Поставщик')).toBe('Не удалось сохранить запись')
  })
})

describe('isInnFieldError', () => {
  it('true для 409 и 400 с проблемой в поле inn', () => {
    expect(isInnFieldError(new ApiError(409, 'duplicate'))).toBe(true)
    expect(isInnFieldError(innValidationError)).toBe(true)
  })

  it('false для сетевой ошибки и 400 по другому полю', () => {
    expect(isInnFieldError(new ApiError(0, 'Ошибка сети'))).toBe(false)
    expect(
      isInnFieldError(
        new ApiError(400, 'Ошибка валидации', {
          error: 'Ошибка валидации',
          details: [{ path: ['name'], message: 'Поле не может быть пустым' }],
        }),
      ),
    ).toBe(false)
  })
})
