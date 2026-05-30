import { describe, it, expect } from 'vitest';
import { toCamelCase } from './caseTransform.js';

describe('toCamelCase', () => {
  it('конвертирует ключи объекта snake_case → camelCase', () => {
    expect(toCamelCase({ user_id: 1, full_name: 'Иван' })).toEqual({
      userId: 1,
      fullName: 'Иван',
    });
  });

  it('рекурсивно обрабатывает вложенные объекты', () => {
    const input = {
      user_id: 1,
      counter_party: { counterparty_id: 'c1', display_name: 'Ромашка' },
    };
    expect(toCamelCase(input)).toEqual({
      userId: 1,
      counterParty: { counterpartyId: 'c1', displayName: 'Ромашка' },
    });
  });

  it('обрабатывает массивы объектов', () => {
    const input = [
      { user_id: 1, full_name: 'a' },
      { user_id: 2, full_name: 'b' },
    ];
    expect(toCamelCase(input)).toEqual([
      { userId: 1, fullName: 'a' },
      { userId: 2, fullName: 'b' },
    ]);
  });

  it('сохраняет ключи без подчёркиваний без изменений', () => {
    expect(toCamelCase({ id: 1, name: 'x' })).toEqual({ id: 1, name: 'x' });
  });

  it('сохраняет Date-объекты без конвертации', () => {
    const date = new Date('2026-05-30T12:00:00Z');
    const result = toCamelCase<{ created_at: Date }>({ created_at: date });
    expect(result).toEqual({ createdAt: date });
  });

  it('возвращает null/undefined как есть', () => {
    expect(toCamelCase(null)).toBeNull();
    expect(toCamelCase(undefined)).toBeUndefined();
  });

  it('примитивы возвращаются без изменений', () => {
    expect(toCamelCase(42)).toBe(42);
    expect(toCamelCase('hello_world')).toBe('hello_world');
    expect(toCamelCase(true)).toBe(true);
  });

  it('многократные подчёркивания обрабатываются (snake_case)', () => {
    expect(toCamelCase({ a_b_c_d: 1 })).toEqual({ aBCD: 1 });
  });

  it('массив примитивов возвращается без изменений', () => {
    expect(toCamelCase([1, 'a', true, null])).toEqual([1, 'a', true, null]);
  });

  it('пустой объект возвращает пустой объект', () => {
    expect(toCamelCase({})).toEqual({});
  });

  it('null внутри массива/объекта сохраняется', () => {
    expect(toCamelCase({ value_a: null, value_b: 1 })).toEqual({ valueA: null, valueB: 1 });
  });
});
