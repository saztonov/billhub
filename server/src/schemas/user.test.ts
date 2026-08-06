import { describe, it, expect } from 'vitest';
import {
  userSchema,
  createUserBodySchema,
  updateUserBodySchema,
  updateUserWithSitesBodySchema,
} from './user.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('userSchema (full DTO)', () => {
  it('валидный admin без counterpartyId', () => {
    expect(() =>
      userSchema.parse({
        id: VALID_UUID,
        email: 'admin@test',
        fullName: 'Админ',
        role: 'admin',
        counterpartyId: null,
        department: 'omts',
        allSites: true,
        isActive: true,
      }),
    ).toThrow(); // 'admin@test' не валидный email
  });

  it('валидный admin (email с доменом верхнего уровня)', () => {
    const parsed = userSchema.parse({
      id: VALID_UUID,
      email: 'admin@test.local',
      fullName: 'Админ',
      role: 'admin',
      counterpartyId: null,
      department: null,
      allSites: true,
      isActive: true,
    });
    expect(parsed.role).toBe('admin');
  });

  it('counterparty_user может иметь counterpartyId', () => {
    const parsed = userSchema.parse({
      id: VALID_UUID,
      email: 'cp@test.local',
      fullName: 'Подрядчик',
      role: 'counterparty_user',
      counterpartyId: VALID_UUID,
      department: null,
      allSites: false,
      isActive: true,
    });
    expect(parsed.counterpartyId).toBe(VALID_UUID);
  });
});

describe('createUserBodySchema', () => {
  it('admin без counterpartyId валиден', () => {
    expect(() =>
      createUserBodySchema.parse({
        email: 'admin@test.local',
        password: 'verystrong123',
        fullName: 'Админ',
        role: 'admin',
      }),
    ).not.toThrow();
  });

  it('counterparty_user без counterpartyId отклоняется (custom refine)', () => {
    expect(() =>
      createUserBodySchema.parse({
        email: 'cp@test.local',
        password: 'verystrong123',
        fullName: 'Подрядчик',
        role: 'counterparty_user',
      }),
    ).toThrow();
  });

  it('counterparty_user с counterpartyId валиден', () => {
    expect(() =>
      createUserBodySchema.parse({
        email: 'cp@test.local',
        password: 'verystrong123',
        fullName: 'Подрядчик',
        role: 'counterparty_user',
        counterpartyId: VALID_UUID,
      }),
    ).not.toThrow();
  });

  it('пароль <8 символов отклоняется', () => {
    expect(() =>
      createUserBodySchema.parse({
        email: 'admin@test.local',
        password: 'short',
        fullName: 'Админ',
        role: 'admin',
      }),
    ).toThrow();
  });

  it('недопустимая роль отклоняется', () => {
    expect(() =>
      createUserBodySchema.parse({
        email: 'admin@test.local',
        password: 'verystrong123',
        fullName: 'X',
        role: 'superadmin',
      }),
    ).toThrow();
  });
});

describe('updateUserBodySchema', () => {
  it('пустой patch валиден', () => {
    expect(() => updateUserBodySchema.parse({})).not.toThrow();
  });

  it('переключение isActive', () => {
    expect(updateUserBodySchema.parse({ isActive: false })).toEqual({ isActive: false });
  });

  it('смена роли на security', () => {
    const parsed = updateUserBodySchema.parse({ role: 'security' });
    expect(parsed.role).toBe('security');
  });
});

describe('updateUserWithSitesBodySchema — смена логина', () => {
  const base = {
    full_name: 'Иванов Иван',
    role: 'user' as const,
    all_sites: false,
    site_ids: [] as string[],
  };

  it('тело без email валидно (совместимость со старым фронтом)', () => {
    const parsed = updateUserWithSitesBodySchema.parse(base);
    expect(parsed.email).toBeUndefined();
    expect(parsed.expected_email).toBeUndefined();
  });

  it('email и expected_email канонизируются: trim + lowercase', () => {
    const parsed = updateUserWithSitesBodySchema.parse({
      ...base,
      email: '  Petrov@SU10.RU ',
      expected_email: 'IVANOV@su10.ru',
    });
    expect(parsed.email).toBe('petrov@su10.ru');
    expect(parsed.expected_email).toBe('ivanov@su10.ru');
  });

  it('email без expected_email отклоняется', () => {
    expect(() =>
      updateUserWithSitesBodySchema.parse({ ...base, email: 'petrov@su10.ru' }),
    ).toThrow();
  });

  it('неверный формат email отклоняется', () => {
    expect(() =>
      updateUserWithSitesBodySchema.parse({
        ...base,
        email: 'не-email',
        expected_email: 'ivanov@su10.ru',
      }),
    ).toThrow();
  });
});
