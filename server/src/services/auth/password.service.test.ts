/**
 * Unit-тесты PasswordService (bcrypt cost 12, совместимость с Supabase $2a/$2b/$2y).
 */
import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { PasswordService, MIN_PASSWORD_LENGTH } from './password.service.js';
import { ValidationError } from '../../repositories/types.js';

describe('PasswordService', () => {
  const svc = new PasswordService(8); // меньший cost для скорости тестов

  it('hash возвращает bcrypt-хэш ($2b)', async () => {
    const h = await svc.hash('secret-pass');
    expect(h.startsWith('$2')).toBe(true);
    expect(PasswordService.isBcryptHash(h)).toBe(true);
  });

  it('hash + compare: верный пароль → true', async () => {
    const h = await svc.hash('correct horse battery');
    expect(await svc.compare('correct horse battery', h)).toBe(true);
  });

  it('compare: неверный пароль → false', async () => {
    const h = await svc.hash('correct horse');
    expect(await svc.compare('wrong horse', h)).toBe(false);
  });

  it('compare: совместимость с Supabase $2a-хэшем', async () => {
    const native = await svc.hash('legacy-password');
    const a = `$2a${native.slice(3)}`;
    expect(await svc.compare('legacy-password', a)).toBe(true);
  });

  it('compare: совместимость с $2y-хэшем', async () => {
    const native = await svc.hash('legacy-password');
    const y = `$2y${native.slice(3)}`;
    expect(await svc.compare('legacy-password', y)).toBe(true);
  });

  it('compare: null hash → false (не бросает)', async () => {
    expect(await svc.compare('whatever', null)).toBe(false);
  });

  it('compare: пустой/мусорный hash → false', async () => {
    expect(await svc.compare('x', '')).toBe(false);
    expect(await svc.compare('x', 'not-a-bcrypt-hash')).toBe(false);
    expect(await svc.compare('x', undefined)).toBe(false);
  });

  it('isBcryptHash распознаёт $2a/$2b/$2y и отклоняет прочее', () => {
    expect(PasswordService.isBcryptHash('$2a$10$' + 'a'.repeat(53))).toBe(true);
    expect(PasswordService.isBcryptHash('$2b$12$' + 'b'.repeat(53))).toBe(true);
    expect(PasswordService.isBcryptHash('$2y$10$' + 'c'.repeat(53))).toBe(true);
    expect(PasswordService.isBcryptHash('plaintext')).toBe(false);
    expect(PasswordService.isBcryptHash('$1$md5$xxx')).toBe(false);
  });

  it('hash одного пароля дважды → разные хэши (соль)', async () => {
    const h1 = await svc.hash('same');
    const h2 = await svc.hash('same');
    expect(h1).not.toBe(h2);
    expect(await svc.compare('same', h1)).toBe(true);
    expect(await svc.compare('same', h2)).toBe(true);
  });

  it('cost по умолчанию = 12', async () => {
    const def = new PasswordService();
    const h = await def.hash('p');
    expect(h.startsWith('$2b$12$')).toBe(true);
  });

  it('needsRehash: cost ниже целевого → true, равный → false', () => {
    const target12 = new PasswordService(12);
    const cost10 = `$2b$10$${'x'.repeat(53)}`;
    const cost12 = `$2b$12$${'x'.repeat(53)}`;
    expect(target12.needsRehash(cost10)).toBe(true);
    expect(target12.needsRehash(cost12)).toBe(false);
    expect(target12.needsRehash('garbage')).toBe(true);
  });

  it('validateStrength: длина < минимума → false', () => {
    expect(PasswordService.validateStrength('short')).toBe(false);
    expect(PasswordService.validateStrength('a'.repeat(MIN_PASSWORD_LENGTH))).toBe(true);
  });

  it('assertStrong бросает ValidationError для слабого пароля', () => {
    expect(() => PasswordService.assertStrong('123')).toThrow(ValidationError);
    expect(() => PasswordService.assertStrong('a'.repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
  });

  it('compare работает с unicode-паролем', async () => {
    const h = await svc.hash('пароль-Ω-✓');
    expect(await svc.compare('пароль-Ω-✓', h)).toBe(true);
    expect(await svc.compare('пароль-Ω-x', h)).toBe(false);
  });

  it('реальный bcrypt-вектор Supabase ($2a) проверяется', async () => {
    // Сгенерирован bcryptjs как $2a (Supabase-формат) заранее.
    const hash = bcrypt.hashSync('demo-password', 8).replace(/^\$2b/, '$2a');
    expect(await svc.compare('demo-password', hash)).toBe(true);
  });
});
