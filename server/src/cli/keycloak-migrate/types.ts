/**
 * Ф3 — типы и порты CLI массового импорта BillHub → Keycloak (`migrate-to-keycloak.ts`).
 *
 * Ядро (payload-builder/preflight/runners) зависит ТОЛЬКО от этих портов — реальные IO-адаптеры
 * (PG, Keycloak Admin, файл) инъектируются в рантайме, а в unit-тестах заменяются моками (без Docker),
 * по образцу `import-passwords.ts`.
 */

/** Строка `public.users`, участвующая в миграции. */
export interface MigrationUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  counterpartyId: string | null;
  isActive: boolean;
  passwordHash: string | null;
}

/** bcrypt-credential Keycloak (точный контракт auth/keycloak/providers/CREDENTIAL_CONTRACT.md). */
export interface KcCredential {
  type: 'password';
  algorithm: 'bcrypt';
  /** JSON-строка `{"value":"<полный $2..хэш>"}` (соль и cost — внутри строки хэша). */
  secretData: string;
  /** JSON-строка `{"hashIterations":<cost>,"algorithm":"bcrypt"}`. */
  credentialData: string;
}

/** Объект пользователя для `partialImport` (обязательны firstName/lastName/email/emailVerified/enabled). */
export interface PartialImportUser {
  id: string;
  username: string;
  email: string;
  emailVerified: true;
  enabled: true;
  firstName: string;
  lastName: string;
  attributes: Record<string, string[]>;
  credentials?: KcCredential[];
}

/** Краткая репрезентация KC-пользователя. */
export interface KcUserRef {
  id: string;
  username?: string;
  email?: string;
  enabled?: boolean;
  attributes?: Record<string, string[]>;
}

/** Ссылка на группу KC (из `/users/{id}/groups`). */
export interface KcGroupRef {
  id: string;
  name: string;
  path: string;
}

/** Ответ `partialImport`. */
export interface PartialImportResultRaw {
  overwritten?: number;
  added?: number;
  skipped?: number;
  results?: { action?: string; resourceName?: string; id?: string }[];
}

export type IfResourceExists = 'FAIL' | 'SKIP' | 'OVERWRITE';

/* --------------------------------- Порты ----------------------------------- */

/** Источник — читает `public.users`. */
export interface SourceReader {
  readUsers(): Promise<MigrationUser[]>;
}

/** Keycloak Admin (подмножество, нужное CLI). Реализуется `KeycloakImportClient`. */
export interface KeycloakAdminPort {
  partialImport(
    users: PartialImportUser[],
    mode: IfResourceExists,
  ): Promise<PartialImportResultRaw>;
  findUserByEmail(email: string): Promise<KcUserRef | null>;
  getUserById(id: string): Promise<KcUserRef | null>;
  getUserGroups(id: string): Promise<KcGroupRef[]>;
  mergeUserAttributes(id: string, attrs: Record<string, string[]>): Promise<void>;
  /** Перевод членства портала: active=true → billhub-active, иначе billhub-pending. */
  setPortalActive(userId: string, active: boolean): Promise<void>;
}

/** Хранилище линков идентичности (реализуется DrizzleIdentityLinkStore). */
export interface LinkStore {
  link(input: {
    userId: string;
    provider: string;
    subject: string;
    emailAtLink: string | null;
  }): Promise<string>;
  findBySubject(provider: string, subject: string): Promise<{ userId: string } | null>;
  findSubjectByUserId(provider: string, userId: string): Promise<string | null>;
}

/** Запись неавторитетного зеркала `users.is_active` (только reconcile, направление KC→БД). */
export interface MirrorWriter {
  setActive(userId: string, active: boolean): Promise<number>;
}

/** Инъектируемый логгер (CLI сам не печатает секреты/хэши/токены). */
export type Logger = (msg: string) => void;
