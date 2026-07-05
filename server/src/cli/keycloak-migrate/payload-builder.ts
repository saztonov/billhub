/**
 * Ф3 — сборка объекта пользователя `partialImport` из строки `public.users`.
 *
 * Инварианты: `id=users.id` (сохранение истории/FK), `emailVerified:true`, `enabled:true`, непустые
 * `firstName`/`lastName`, `attributes.billhub_user_id=[id]` (стабильный correlation-key для резолва).
 * Исходный `full_name` кладём best-effort доп. атрибутом (под unmanagedAttributePolicy=ADMIN_EDIT
 * сохранится; если KC отбросит — не критично, reconcile-сверка имён best-effort). bcrypt-хэш → credential
 * по контракту; null/не-bcrypt → без credentials (вход только после admin-сброса пароля).
 */
import { PasswordService } from '../../services/auth/password.service.js';
import { buildBcryptCredential } from './bcrypt-credential.js';
import { splitFullName } from './name-split.js';
import type { MigrationUser, PartialImportUser } from './types.js';

function emailLocalPart(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

export function buildUserPayload(u: MigrationUser): PartialImportUser {
  const { firstName, lastName } = splitFullName(u.fullName, emailLocalPart(u.email));

  const attributes: Record<string, string[]> = { billhub_user_id: [u.id] };
  const fullName = (u.fullName ?? '').trim();
  if (fullName) attributes.full_name = [fullName];

  const payload: PartialImportUser = {
    id: u.id,
    username: u.email,
    email: u.email,
    emailVerified: true,
    enabled: true,
    firstName,
    lastName,
    attributes,
  };

  if (u.passwordHash && PasswordService.isBcryptHash(u.passwordHash)) {
    payload.credentials = [buildBcryptCredential(u.passwordHash)];
  }
  return payload;
}
