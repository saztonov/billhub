/**
 * Юнит-тесты имён выгрузки в SIGNAL: нормализация названий поставщиков,
 * сопоставление папок, имена файлов и коллизии.
 */
import { describe, expect, it } from 'vitest';
import {
  buildFileName,
  folderKey,
  guessMimeType,
  isSupplyFolder,
  normalizeOrgName,
  sanitizeSegment,
  supplierFolderNames,
  uniqueName,
} from './sgnl-names.js';

describe('normalizeOrgName', () => {
  it('убирает кавычки всех видов и лишние пробелы (стиль SIGNAL)', () => {
    expect(normalizeOrgName('ООО "ЭК "ТЕМА"')).toBe('ООО ЭК ТЕМА');
    expect(normalizeOrgName('АО «ТД «ЭЛЕКТРОТЕХМОНТАЖ»')).toBe('АО ТД ЭЛЕКТРОТЕХМОНТАЖ');
    expect(normalizeOrgName('  ИП  Сеньков   Яков ')).toBe('ИП Сеньков Яков');
  });
});

describe('sanitizeSegment', () => {
  it('заменяет запрещённые символы и обрезает точки/пробелы в конце', () => {
    expect(sanitizeSegment('Счёт 1/2: итог?.')).toBe('Счёт 1_2_ итог_');
    expect(sanitizeSegment('файл. ')).toBe('файл');
  });
  it('пустое имя заменяется подстановкой', () => {
    expect(sanitizeSegment('   ')).toBe('Без названия');
  });
});

describe('folderKey / isSupplyFolder', () => {
  it('сравнение без учёта регистра, ё, кавычек и пробелов', () => {
    expect(folderKey('ООО ЭК ТЕМА')).toBe(folderKey('ооо "эк  тема"'));
    expect(folderKey('Счёта')).toBe(folderKey('счета'));
  });
  it('узнаёт «12. Снабжение» с любым номером раздела', () => {
    expect(isSupplyFolder('12. Снабжение')).toBe(true);
    expect(isSupplyFolder('Снабжение')).toBe(true);
    expect(isSupplyFolder('7) снабжение')).toBe(true);
    expect(isSupplyFolder('12. Снабжение (архив)')).toBe(false);
    expect(isSupplyFolder('13АВ-РД-ВК. Водоснабжение')).toBe(false);
  });
});

describe('supplierFolderNames', () => {
  it('одноимённые после нормализации поставщики различаются ИНН', () => {
    const names = supplierFolderNames([
      { id: 'a', name: 'ООО "ЛИГА"', inn: '111' },
      { id: 'b', name: 'ООО ЛИГА', inn: '222' },
      { id: 'c', name: 'ООО "ГРИФФ"', inn: '333' },
      { id: 'c', name: 'ООО "ГРИФФ"', inn: '333' },
    ]);
    expect(names.get('a')).toBe('ООО ЛИГА (ИНН 111)');
    expect(names.get('b')).toBe('ООО ЛИГА (ИНН 222)');
    expect(names.get('c')).toBe('ООО ГРИФФ');
  });
});

describe('buildFileName / uniqueName', () => {
  it('имя файла — «№ заявки_исходное имя»', () => {
    expect(buildFileName('1234', 'Счёт №45.pdf')).toBe('1234_Счёт №45.pdf');
  });
  it('коллизии получают суффикс перед расширением, без учёта регистра', () => {
    const taken = new Set(['1_счет.pdf']);
    expect(uniqueName('1_Счет.pdf', taken)).toBe('1_Счет (2).pdf');
    expect(uniqueName('1_Счет.pdf', taken)).toBe('1_Счет (3).pdf');
    expect(uniqueName('2_без расширения', taken)).toBe('2_без расширения');
    expect(uniqueName('2_без расширения', taken)).toBe('2_без расширения (2)');
  });
});

describe('guessMimeType', () => {
  it('определяет тип по расширению, иначе octet-stream', () => {
    expect(guessMimeType('a.PDF')).toBe('application/pdf');
    expect(guessMimeType('a.xlsx')).toContain('spreadsheetml');
    expect(guessMimeType('a.unknown')).toBe('application/octet-stream');
  });
});
