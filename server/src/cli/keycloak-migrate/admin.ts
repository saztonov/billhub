/**
 * Ф3 — KeycloakImportClient: тонкий подкласс KeycloakAdminClient, добавляющий CLI-only операции
 * (`partialImport`, `getUserGroups`, чтение полной репрезентации с attributes). Переиспользует
 * общий protected-слой токена/adminFetch/редакции (без дублирования — иначе риск утечки токена в лог).
 *
 * Ходит под ОТДЕЛЬНЫМИ import-кредами (`billhub-import`, роль manage-realm), инъектируемыми в
 * конструктор базового класса — сервис-аккаунт billhub (manage-users) для partialImport не годится.
 */
import { KeycloakAdminClient } from '../../services/auth/keycloak/admin-client.js';
import type {
  IfResourceExists,
  KcGroupRef,
  KcUserRef,
  KeycloakAdminPort,
  PartialImportResultRaw,
  PartialImportUser,
} from './types.js';

export class KeycloakImportClient extends KeycloakAdminClient {
  /** POST /admin/realms/{realm}/partialImport — требует роль manage-realm. */
  async partialImport(
    users: PartialImportUser[],
    mode: IfResourceExists,
  ): Promise<PartialImportResultRaw> {
    const res = await this.adminFetch('/partialImport', {
      method: 'POST',
      body: JSON.stringify({ ifResourceExists: mode, users }),
    });
    if (!res.ok) throw new Error(`Keycloak partialImport: HTTP ${res.status}`);
    return (await res.json()) as PartialImportResultRaw;
  }

  /** Членство пользователя в группах (GET /users/{id}/groups). */
  async getUserGroups(id: string): Promise<KcGroupRef[]> {
    const res = await this.adminFetch(`/users/${encodeURIComponent(id)}/groups`);
    if (!res.ok) throw new Error(`Keycloak get user groups: HTTP ${res.status}`);
    return (await res.json()) as KcGroupRef[];
  }

  /** Полная репрезентация по id (с attributes). null — если нет. */
  async getUserFull(id: string): Promise<KcUserRef | null> {
    const res = await this.adminFetch(`/users/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Keycloak get user (full): HTTP ${res.status}`);
    return (await res.json()) as KcUserRef;
  }

  /** По email exact, с attributes (briefRepresentation=false). null — если нет. */
  async findUserRefByEmail(email: string): Promise<KcUserRef | null> {
    const res = await this.adminFetch(
      `/users?email=${encodeURIComponent(email)}&exact=true&briefRepresentation=false`,
    );
    if (!res.ok) throw new Error(`Keycloak find user by email: HTTP ${res.status}`);
    const arr = (await res.json()) as KcUserRef[];
    return arr[0] ?? null;
  }
}

/** Адаптер: приводит KeycloakImportClient к порту KeycloakAdminPort (для инъекции в runners). */
export function buildKeycloakAdminPort(client: KeycloakImportClient): KeycloakAdminPort {
  return {
    partialImport: (users, mode) => client.partialImport(users, mode),
    findUserByEmail: (email) => client.findUserRefByEmail(email),
    getUserById: (id) => client.getUserFull(id),
    getUserGroups: (id) => client.getUserGroups(id),
    mergeUserAttributes: (id, attrs) => client.mergeUserAttributes(id, attrs),
    setPortalActive: (userId, active) => client.setPortalActive(userId, active),
  };
}
