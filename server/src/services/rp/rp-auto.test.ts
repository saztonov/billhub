/**
 * Юнит-тесты помощников автосоздания РП: текст письма, дата по Москве, разбор настройки,
 * границы удаления файлов РП из S3.
 */
import { describe, it, expect } from 'vitest';
import { buildRpLetterContent, moscowToday } from './rp-letter-content.js';
import { parseRpAutoCreate } from './rp-auto-create-setting.js';
import { ownRpFileKeys } from './rp-file-scope.js';

/** Нормализация неразрывных пробелов ru-RU для сравнения */
const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('buildRpLetterContent', () => {
  it('сумма, поставщик и комментарий через запятую', () => {
    const text = buildRpLetterContent([
      { invoiceAmount: 1234567.5, supplierName: ' ООО Ромашка ', comment: ' Бетон М300 ' },
    ]);
    expect(plain(text)).toBe('1 234 567,50 ₽, ООО Ромашка, Бетон М300');
  });

  it('без поставщика и комментария — только сумма', () => {
    expect(
      plain(buildRpLetterContent([{ invoiceAmount: null, supplierName: null, comment: '  ' }])),
    ).toBe('0,00 ₽');
  });

  it('пустой список — пустая строка', () => {
    expect(buildRpLetterContent([])).toBe('');
  });
});

describe('moscowToday', () => {
  it('дата по Москве, а не по UTC', () => {
    // 22:30 UTC 31 декабря — в Москве уже 1 января.
    expect(moscowToday(new Date('2026-12-31T22:30:00Z'))).toBe('2027-01-01');
    expect(moscowToday(new Date('2026-06-15T10:00:00Z'))).toBe('2026-06-15');
  });
});

describe('parseRpAutoCreate', () => {
  it('нет значения или повреждено — включено', () => {
    expect(parseRpAutoCreate(undefined)).toBe(true);
    expect(parseRpAutoCreate(null)).toBe(true);
    expect(parseRpAutoCreate({ enabled: 'no' })).toBe(true);
  });

  it('явное значение', () => {
    expect(parseRpAutoCreate({ enabled: false })).toBe(false);
    expect(parseRpAutoCreate({ enabled: true })).toBe(true);
  });
});

describe('ownRpFileKeys', () => {
  it('оставляет только ключи папки этой РП', () => {
    const id = 'aaaa-1';
    expect(
      ownRpFileKeys(id, [
        `rp-letters/${id}/1_scan.pdf`,
        `rp-letters/${id}/service/2_qr.png`,
        'ООО_Ромашка/0001/3_invoice.pdf',
        'rp-letters/aaaa-10/4_other.pdf',
        'founding/5_ustav.pdf',
      ]),
    ).toEqual([`rp-letters/${id}/1_scan.pdf`, `rp-letters/${id}/service/2_qr.png`]);
  });
});
