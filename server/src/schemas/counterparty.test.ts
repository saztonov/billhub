import { describe, it, expect } from 'vitest';
import {
  counterpartySchema,
  createCounterpartyBodySchema,
  updateCounterpartyBodySchema,
  listCounterpartiesQuerySchema,
} from './counterparty.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_INN = '7710140679';

describe('counterpartySchema (full DTO)', () => {
  it('принимает минимальный валидный DTO', () => {
    const parsed = counterpartySchema.parse({
      id: VALID_UUID,
      name: 'ООО Ромашка',
      inn: VALID_INN,
      address: '',
      alternativeNames: [],
      createdAt: '2026-05-29T10:00:00.000Z',
    });
    expect(parsed.id).toBe(VALID_UUID);
    expect(parsed.address).toBe('');
  });

  it('опциональный lastSecurityStatus принимает approved/rejected/null', () => {
    const base = {
      id: VALID_UUID,
      name: 'ООО',
      inn: VALID_INN,
      address: '',
      alternativeNames: [],
      createdAt: '2026-05-29T10:00:00.000Z',
    };
    expect(() =>
      counterpartySchema.parse({ ...base, lastSecurityStatus: 'approved' }),
    ).not.toThrow();
    expect(() =>
      counterpartySchema.parse({ ...base, lastSecurityStatus: 'rejected' }),
    ).not.toThrow();
    expect(() => counterpartySchema.parse({ ...base, lastSecurityStatus: null })).not.toThrow();
  });

  it('lastSecurityStatus="pending" отклоняется (не enum)', () => {
    expect(() =>
      counterpartySchema.parse({
        id: VALID_UUID,
        name: 'ООО',
        inn: VALID_INN,
        address: '',
        alternativeNames: [],
        createdAt: '2026-05-29T10:00:00.000Z',
        lastSecurityStatus: 'pending',
      }),
    ).toThrow();
  });
});

describe('createCounterpartyBodySchema', () => {
  it('принимает минимальные обязательные поля', () => {
    const parsed = createCounterpartyBodySchema.parse({ name: 'X', inn: VALID_INN });
    expect(parsed.name).toBe('X');
  });

  it('отклоняет пустое имя', () => {
    expect(() => createCounterpartyBodySchema.parse({ name: '', inn: VALID_INN })).toThrow();
  });

  it('отклоняет невалидный ИНН', () => {
    expect(() => createCounterpartyBodySchema.parse({ name: 'X', inn: '123' })).toThrow();
  });
});

describe('updateCounterpartyBodySchema', () => {
  it('все поля опциональны — принимает пустой объект', () => {
    expect(() => updateCounterpartyBodySchema.parse({})).not.toThrow();
  });

  it('принимает частичный update', () => {
    const parsed = updateCounterpartyBodySchema.parse({ name: 'Новое имя' });
    expect(parsed.name).toBe('Новое имя');
  });

  it('отклоняет пустое имя при update', () => {
    expect(() => updateCounterpartyBodySchema.parse({ name: '' })).toThrow();
  });
});

describe('listCounterpartiesQuerySchema', () => {
  it('по умолчанию sbFilter=all, page=1, pageSize=20', () => {
    expect(listCounterpartiesQuerySchema.parse({})).toMatchObject({
      sbFilter: 'all',
      page: 1,
      pageSize: 20,
    });
  });

  it('принимает sbFilter=pending', () => {
    const parsed = listCounterpartiesQuerySchema.parse({ sbFilter: 'pending' });
    expect(parsed.sbFilter).toBe('pending');
  });

  it('coerce page/pageSize из строк', () => {
    const parsed = listCounterpartiesQuerySchema.parse({ page: '5', pageSize: '50' });
    expect(parsed.page).toBe(5);
    expect(parsed.pageSize).toBe(50);
  });

  it('отклоняет недопустимый sbFilter', () => {
    expect(() => listCounterpartiesQuerySchema.parse({ sbFilter: 'rejected' })).toThrow();
  });
});
