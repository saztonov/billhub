import { describe, it, expect } from 'vitest';
import {
  uuidSchema,
  emailSchema,
  innSchema,
  isoDateSchema,
  paginationSchema,
  paginatedResponseSchema,
} from './common.js';
import { z } from 'zod';

describe('uuidSchema', () => {
  it('принимает валидный UUID v4', () => {
    expect(() => uuidSchema.parse('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
  });

  it('отклоняет невалидный UUID', () => {
    expect(() => uuidSchema.parse('not-a-uuid')).toThrow();
  });

  it('отклоняет пустую строку', () => {
    expect(() => uuidSchema.parse('')).toThrow();
  });
});

describe('emailSchema', () => {
  it('принимает обычный email', () => {
    expect(emailSchema.parse('user@example.com')).toBe('user@example.com');
  });

  it('отклоняет невалидный email', () => {
    expect(() => emailSchema.parse('not-an-email')).toThrow();
  });

  it('отклоняет email длиной >255 символов', () => {
    const long = 'a'.repeat(250) + '@example.com';
    expect(() => emailSchema.parse(long)).toThrow();
  });
});

describe('innSchema', () => {
  it('принимает 10-значный ИНН (юрлица)', () => {
    expect(innSchema.parse('7710140679')).toBe('7710140679');
  });

  it('принимает 12-значный ИНН (физлица/ИП)', () => {
    expect(innSchema.parse('500100732259')).toBe('500100732259');
  });

  it('отклоняет ИНН с буквами', () => {
    expect(() => innSchema.parse('77101A0679')).toThrow();
  });

  it('отклоняет ИНН неверной длины', () => {
    expect(() => innSchema.parse('123')).toThrow();
    expect(() => innSchema.parse('12345678901')).toThrow();
  });
});

describe('isoDateSchema', () => {
  it('принимает YYYY-MM-DD', () => {
    expect(isoDateSchema.parse('2026-05-30')).toBe('2026-05-30');
  });

  it('отклоняет ISO с временем', () => {
    expect(() => isoDateSchema.parse('2026-05-30T12:00:00Z')).toThrow();
  });

  it('отклоняет некорректный формат', () => {
    expect(() => isoDateSchema.parse('30.05.2026')).toThrow();
  });
});

describe('paginationSchema', () => {
  it('по умолчанию page=1, pageSize=20', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('coerce строковых query-параметров в числа', () => {
    expect(paginationSchema.parse({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it('отклоняет pageSize > 100', () => {
    expect(() => paginationSchema.parse({ pageSize: 1000 })).toThrow();
  });

  it('отклоняет page < 1', () => {
    expect(() => paginationSchema.parse({ page: 0 })).toThrow();
  });
});

describe('paginatedResponseSchema', () => {
  it('создаёт схему с items + totalCount', () => {
    const schema = paginatedResponseSchema(z.object({ id: z.string() }));
    const result = schema.parse({ items: [{ id: 'a' }, { id: 'b' }], totalCount: 2 });
    expect(result.items.length).toBe(2);
    expect(result.totalCount).toBe(2);
  });

  it('отклоняет отрицательный totalCount', () => {
    const schema = paginatedResponseSchema(z.string());
    expect(() => schema.parse({ items: [], totalCount: -1 })).toThrow();
  });
});
