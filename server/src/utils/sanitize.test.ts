import { describe, it, expect } from 'vitest';
import { sanitizeForS3 } from './sanitize.js';

describe('sanitizeForS3 (backend)', () => {
  it('транслитерирует строчную кириллицу', () => {
    expect(sanitizeForS3('привет')).toBe('privet');
  });

  it('транслитерирует прописную кириллицу', () => {
    expect(sanitizeForS3('Привет')).toBe('Privet');
  });

  it('пробелы → подчёркивания', () => {
    expect(sanitizeForS3('Привет Мир')).toBe('Privet_Mir');
  });

  it('множественные подчёркивания схлопываются', () => {
    expect(sanitizeForS3('a   b')).toBe('a_b');
  });

  it('обрезает ведущие/хвостовые подчёркивания', () => {
    expect(sanitizeForS3('___test___')).toBe('test');
  });

  it('латиница, цифры, точки и дефисы сохраняются', () => {
    expect(sanitizeForS3('file.name-001.pdf')).toBe('file.name-001.pdf');
  });

  it('небезопасные символы заменяются на _', () => {
    expect(sanitizeForS3('a@b#c$d')).toBe('a_b_c_d');
  });

  it('диграфы транслитерации (ё → yo, ж → zh, ц → ts, ч → ch, ш → sh, щ → shch, ю → yu, я → ya)', () => {
    expect(sanitizeForS3('ёжчшщюя')).toBe('yozhchshshchyuya');
  });

  it('твёрдый и мягкий знаки удаляются', () => {
    expect(sanitizeForS3('объявление')).toBe('obyavlenie');
  });

  it('кириллица + латиница + цифры', () => {
    expect(sanitizeForS3('ООО Ромашка №1.pdf')).toBe('OOO_Romashka_1.pdf');
  });

  it('пустая строка возвращает пустую', () => {
    expect(sanitizeForS3('')).toBe('');
  });

  it('строка только из небезопасных символов схлопывается в пустую', () => {
    expect(sanitizeForS3('@@@')).toBe('');
  });

  it('защита от path traversal: слэши заменяются на _', () => {
    expect(sanitizeForS3('a/b/c')).toBe('a_b_c');
    // ../etc/passwd → '..' допустимо как точки (точка не считается небезопасной), слэши заменяются.
    expect(sanitizeForS3('../etc/passwd')).toBe('.._etc_passwd');
  });

  it('итоговый ключ не содержит прямых/обратных слэшей', () => {
    expect(sanitizeForS3('../foo/bar')).not.toMatch(/[\\/]/);
    expect(sanitizeForS3('\\windows\\path')).not.toMatch(/[\\/]/);
  });
});
