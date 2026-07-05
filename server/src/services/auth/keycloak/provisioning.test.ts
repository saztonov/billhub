/** Ф2 — unit-тесты провижининга KC-идентичности (Вариант B / admin-create). */
import { describe, expect, it, vi } from 'vitest';
import { provisionPortalUser, type ProvisioningAdmin } from './provisioning.js';

function mockAdmin(sub = 'kc-sub-1'): ProvisioningAdmin & {
  createUser: ReturnType<typeof vi.fn>;
  addPortalPending: ReturnType<typeof vi.fn>;
  deleteUser: ReturnType<typeof vi.fn>;
} {
  return {
    createUser: vi.fn(async () => sub),
    addPortalPending: vi.fn(async () => {}),
    deleteUser: vi.fn(async () => {}),
  };
}

describe('provisionPortalUser', () => {
  it('создаёт KC-юзера с billhub_user_id, паролем, emailVerified и кладёт в billhub-pending', async () => {
    const admin = mockAdmin('sub-42');
    const sub = await provisionPortalUser(admin, {
      userId: 'u-42',
      email: 'ivan@example.com',
      fullName: 'Иванов Иван',
      password: 'secret-pass',
    });
    expect(sub).toBe('sub-42');
    const rep = admin.createUser.mock.calls[0]![0];
    expect(rep.username).toBe('ivan@example.com');
    expect(rep.email).toBe('ivan@example.com');
    expect(rep.emailVerified).toBe(true);
    expect(rep.enabled).toBe(true);
    expect(rep.firstName).toBe('Иванов');
    expect(rep.lastName).toBe('Иван');
    expect(rep.attributes).toEqual({ billhub_user_id: ['u-42'] });
    expect(rep.credentials).toEqual([{ type: 'password', value: 'secret-pass', temporary: false }]);
    expect(admin.addPortalPending).toHaveBeenCalledWith('sub-42');
  });

  it('пустое ФИО → firstName/lastName из локальной части email (оба непустые)', async () => {
    const admin = mockAdmin();
    await provisionPortalUser(admin, {
      userId: 'u1',
      email: 'petrov@example.com',
      fullName: '   ',
      password: 'pw12345678',
    });
    const rep = admin.createUser.mock.calls[0]![0];
    expect(rep.firstName).toBe('petrov');
    expect(rep.lastName).toBe('petrov');
  });
});
