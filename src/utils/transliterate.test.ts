import { describe, it, expect } from 'vitest'
import { sanitizeForS3 } from './transliterate'

describe('sanitizeForS3', () => {
  it('транслитерирует строчную кириллицу в латиницу', () => {
    expect(sanitizeForS3('привет')).toBe('privet')
  })

  it('транслитерирует заглавную кириллицу', () => {
    expect(sanitizeForS3('Привет')).toBe('Privet')
  })

  it('пробелы заменяются на подчёркивания', () => {
    expect(sanitizeForS3('Привет Мир')).toBe('Privet_Mir')
  })

  it('множественные подчёркивания схлопываются в одно', () => {
    expect(sanitizeForS3('a   b')).toBe('a_b')
  })

  it('обрезает ведущие и хвостовые подчёркивания', () => {
    expect(sanitizeForS3('___test___')).toBe('test')
  })

  it('латиница сохраняется без изменений', () => {
    expect(sanitizeForS3('hello-world.txt')).toBe('hello-world.txt')
  })

  it('точки и дефисы сохраняются', () => {
    expect(sanitizeForS3('file.name-001.pdf')).toBe('file.name-001.pdf')
  })

  it('небезопасные символы заменяются', () => {
    expect(sanitizeForS3('a@b#c$d')).toBe('a_b_c_d')
  })

  it('диграфы транслитерации (ё, ж, ц, ч, ш, щ, ю, я)', () => {
    expect(sanitizeForS3('ёжчшщюя')).toBe('yozhchshshchyuya')
  })

  it('твёрдый и мягкий знаки удаляются', () => {
    expect(sanitizeForS3('объявление')).toBe('obyavlenie')
  })

  it('смешанная строка кириллицы и латиницы', () => {
    expect(sanitizeForS3('ООО Ромашка №1.pdf')).toBe('OOO_Romashka_1.pdf')
  })

  it('пустая строка возвращает пустую', () => {
    expect(sanitizeForS3('')).toBe('')
  })

  it('строка только из небезопасных символов схлопывается', () => {
    expect(sanitizeForS3('@@@')).toBe('')
  })
})
