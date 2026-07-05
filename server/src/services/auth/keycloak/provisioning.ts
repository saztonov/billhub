/**
 * Ф2 — провижининг идентичности пользователя в Keycloak через Admin API (Вариант B: регистрация на
 * IdP закрыта). Общий путь для register-counterparty и admin-create (POST /api/users).
 *
 * Создаёт KC-юзера (enabled, emailVerified, firstName/lastName, attribute billhub_user_id=<локальный
 * users.id>, credentials из пароля — KC хэширует argon2) и кладёт в billhub-pending (новые неактивны).
 * Возвращает реальный KC `sub` для записи в user_identity_links. Пароль в лог не попадает.
 *
 * Идентичность связывается через attribute `billhub_user_id` + link, поэтому KC-`sub` может быть любым
 * (в отличие от bulk-import, где id=users.id ради истории).
 */
import { emailLocalPart, splitFullName } from './name.js';

/** Минимальная поверхность Admin-клиента, нужная провижинингу (для инъекции/моков в тестах). */
export interface ProvisioningAdmin {
  createUser(rep: {
    username: string;
    email: string;
    emailVerified?: boolean;
    enabled?: boolean;
    firstName: string;
    lastName: string;
    attributes?: Record<string, string[]>;
    credentials?: { type: 'password'; value: string; temporary: boolean }[];
  }): Promise<string>;
  addPortalPending(userId: string): Promise<void>;
  deleteUser(id: string): Promise<void>;
}

export interface ProvisionInput {
  /** Локальный users.id — becomes attribute billhub_user_id. */
  userId: string;
  email: string;
  fullName: string;
  password: string;
}

/** Создаёт KC-идентичность (+ billhub-pending). Возвращает реальный KC sub. */
export async function provisionPortalUser(
  admin: ProvisioningAdmin,
  input: ProvisionInput,
): Promise<string> {
  const { firstName, lastName } = splitFullName(input.fullName, emailLocalPart(input.email));
  const sub = await admin.createUser({
    username: input.email,
    email: input.email,
    emailVerified: true,
    enabled: true,
    firstName,
    lastName,
    attributes: { billhub_user_id: [input.userId] },
    credentials: [{ type: 'password', value: input.password, temporary: false }],
  });
  await admin.addPortalPending(sub);
  return sub;
}
