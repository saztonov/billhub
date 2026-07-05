/**
 * Keycloak Admin REST клиент (typed fetch). В grant-only модели BillHub НЕ создаёт
 * пользователей — клиент используется для:
 *   - чтения пользователя по email/subject (линковка идентичности);
 *   - управления членством в группах портала billhub-pending/billhub-active (гейт доступа).
 *
 * Токен сервис-аккаунта получаем через client_credentials на token-endpoint realm; кешируем
 * до истечения. Секреты и bearer-токен НЕ логируются (redaction — logger.ts).
 */
import { config } from '../../../config.js';

export interface KcUser {
  id: string;
  username?: string;
  email?: string;
  enabled?: boolean;
  createdTimestamp?: number;
}

interface KcGroup {
  id: string;
  name: string;
  path: string;
}

interface KcTokenResponse {
  access_token: string;
  expires_in: number;
}

/**
 * Явная инъекция кредов Admin REST. Пусто → берётся config (рантайм-поведение billhub SA).
 * Позволяет CLI импорта (Ф3) ходить под отдельным клиентом billhub-import (manage-realm),
 * переиспользуя общий слой токена/fetch/редакции — см. KeycloakImportClient.
 */
export interface KeycloakAdminCredentials {
  baseUrl?: string;
  realm?: string;
  clientId?: string;
  clientSecret?: string;
}

export class KeycloakAdminClient {
  private token: { value: string; expiresAtMs: number } | null = null;
  private readonly groupIdCache = new Map<string, string>();

  constructor(private readonly creds: KeycloakAdminCredentials = {}) {}

  private baseUrl(): string {
    const explicit = this.creds.baseUrl || config.kcAdminBaseUrl;
    if (explicit) return explicit.replace(/\/+$/, '');
    // Выводим из issuer: https://auth.su10.ru/realms/su10 -> https://auth.su10.ru
    const issuer = new URL(config.oidcIssuer);
    return `${issuer.protocol}//${issuer.host}`;
  }

  private realm(): string {
    const explicit = this.creds.realm || config.kcAdminRealm;
    if (explicit) return explicit;
    const m = config.oidcIssuer.match(/\/realms\/([^/]+)/);
    return m?.[1] ?? 'master';
  }

  private clientId(): string {
    return this.creds.clientId || config.kcAdminClientId || config.oidcClientId;
  }

  private clientSecret(): string {
    return this.creds.clientSecret || config.kcAdminClientSecret || config.oidcClientSecret;
  }

  /** Realm Admin REST, к которому обращается клиент (для CLI-подкласса/диагностики). */
  protected currentRealm(): string {
    return this.realm();
  }

  protected async getToken(): Promise<string> {
    if (this.token && this.token.expiresAtMs > Date.now() + 10_000) {
      return this.token.value;
    }
    const url = `${this.baseUrl()}/realms/${this.realm()}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new Error(`Keycloak admin token: HTTP ${res.status}`);
    }
    const json = (await res.json()) as KcTokenResponse;
    this.token = { value: json.access_token, expiresAtMs: Date.now() + json.expires_in * 1000 };
    return this.token.value;
  }

  protected async adminFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.getToken();
    const url = `${this.baseUrl()}/admin/realms/${this.realm()}${path}`;
    return fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  }

  /** Пользователь по email (exact). null — если нет. */
  async findUserByEmail(email: string): Promise<KcUser | null> {
    const res = await this.adminFetch(`/users?email=${encodeURIComponent(email)}&exact=true`);
    if (!res.ok) throw new Error(`Keycloak find user by email: HTTP ${res.status}`);
    const arr = (await res.json()) as KcUser[];
    return arr[0] ?? null;
  }

  /** Пользователь по id (subject). null — если нет. */
  async getUserById(id: string): Promise<KcUser | null> {
    const res = await this.adminFetch(`/users/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Keycloak get user: HTTP ${res.status}`);
    return (await res.json()) as KcUser;
  }

  /**
   * Досоздать/обновить атрибуты пользователя, НЕ стирая профиль. KC на PUT /users/{id}
   * заменяет `attributes` целиком, поэтому: GET полной репрезентации → merge attributes →
   * PUT полной репрезентации. Нужен Ф3 (до-проставить billhub_user_id при SKIP) и Ф2.
   */
  async mergeUserAttributes(id: string, attrs: Record<string, string[]>): Promise<void> {
    const getRes = await this.adminFetch(`/users/${encodeURIComponent(id)}`);
    if (!getRes.ok) throw new Error(`Keycloak get user (merge attrs): HTTP ${getRes.status}`);
    const user = (await getRes.json()) as Record<string, unknown>;
    const existing = (user.attributes as Record<string, string[]> | undefined) ?? {};
    const body = { ...user, attributes: { ...existing, ...attrs } };
    const putRes = await this.adminFetch(`/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (!putRes.ok && putRes.status !== 204) {
      throw new Error(`Keycloak update user (merge attrs): HTTP ${putRes.status}`);
    }
  }

  private async resolveGroupId(name: string): Promise<string> {
    const cached = this.groupIdCache.get(name);
    if (cached) return cached;
    const res = await this.adminFetch(`/groups?search=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Keycloak find group: HTTP ${res.status}`);
    const arr = (await res.json()) as KcGroup[];
    const group = arr.find((g) => g.name === name);
    if (!group) throw new Error(`Keycloak: группа портала не найдена: ${name}`);
    this.groupIdCache.set(name, group.id);
    return group.id;
  }

  private async addToGroup(userId: string, groupName: string): Promise<void> {
    const groupId = await this.resolveGroupId(groupName);
    const res = await this.adminFetch(`/users/${encodeURIComponent(userId)}/groups/${groupId}`, {
      method: 'PUT',
    });
    if (!res.ok && res.status !== 204) throw new Error(`Keycloak add to group: HTTP ${res.status}`);
  }

  private async removeFromGroup(userId: string, groupName: string): Promise<void> {
    const groupId = await this.resolveGroupId(groupName);
    const res = await this.adminFetch(`/users/${encodeURIComponent(userId)}/groups/${groupId}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Keycloak remove from group: HTTP ${res.status}`);
    }
  }

  /** Завести доступ к порталу в неактивном виде (группа billhub-pending). */
  async addPortalPending(userId: string): Promise<void> {
    await this.addToGroup(userId, config.kcPortalGroupPending);
  }

  /**
   * Установить активность доступа к порталу: перевод pending <-> active.
   * active=true → в billhub-active, из billhub-pending; active=false → наоборот.
   */
  async setPortalActive(userId: string, active: boolean): Promise<void> {
    if (active) {
      await this.addToGroup(userId, config.kcPortalGroupActive);
      await this.removeFromGroup(userId, config.kcPortalGroupPending);
    } else {
      await this.addToGroup(userId, config.kcPortalGroupPending);
      await this.removeFromGroup(userId, config.kcPortalGroupActive);
    }
  }
}

/** Ленивый singleton (используется только в keycloak-режиме). */
export const keycloakAdminClient = new KeycloakAdminClient();
