/**
 * UserRepository — интерфейс доступа к данным пользователей.
 *
 * В Iteration 6 (standalone auth) добавляются методы для управления password_hash
 * и refresh_tokens. Сейчас (Iteration 3) интерфейс покрывает только базовый CRUD + checks для logIn.
 */
import type {
  User,
  CreateUserBody,
  UpdateUserBody,
  ListUsersQuery,
  UserDetail,
  UserRole,
} from '../schemas/user.js';
import type { PaginatedResult } from './types.js';

/** Нормализованные данные обновления пользователя с привязкой к объектам (PUT /users/:id). */
export interface UserSitesUpdate {
  fullName: string;
  role: UserRole;
  counterpartyId: string | null;
  department: string | null;
  allSites: boolean;
  siteIds: string[];
}

/** Данные создания профиля пользователя-подрядчика. */
export interface CounterpartyUserRecord {
  id: string;
  email: string;
  fullName: string;
  counterpartyId: string;
  /**
   * Активность строки. По умолчанию false: новые пользователи заводятся неактивными и
   * активируются админом (переключатель в UsersTab / группа Keycloak). См. решение v4.
   */
  isActive?: boolean;
}

export interface UserRepository {
  getById(id: string): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;

  list(query: ListUsersQuery): Promise<PaginatedResult<User>>;

  create(body: CreateUserBody): Promise<User>;
  update(id: string, body: UpdateUserBody): Promise<User>;
  delete(id: string): Promise<void>;

  /**
   * Включает/выключает пользователя (мягкая деактивация без удаления).
   * Сейчас обёртка над update({isActive}); метод сохраняется в интерфейсе,
   * чтобы в Iteration 6 (audit-логирование) добавить тут audit-event атомарно.
   */
  setActive(id: string, isActive: boolean): Promise<User>;

  /** Все пользователи с именем контрагента и привязанными объектами (admin-таблица). */
  listWithDetails(): Promise<UserDetail[]>;

  /** Один пользователь с деталями (имя контрагента + объекты). Бросает NotFoundError. */
  getWithDetails(id: string): Promise<UserDetail>;

  /** Доступ к объектам: { allSites, siteIds }. Бросает NotFoundError. */
  getSiteAccess(id: string): Promise<{ allSites: boolean; siteIds: string[] }>;

  /** Привязанные объекты пользователя (id объектов). */
  getSiteMappingIds(id: string): Promise<{ constructionSiteId: string }[]>;

  /**
   * Обновление пользователя + переустановка привязок к объектам + авторезолв
   * уведомлений missing_specialist. Бросает ValidationError при нарушении правил Штаба.
   * Всё — в одной транзакции (Drizzle).
   */
  updateWithSites(id: string, input: UserSitesUpdate): Promise<void>;

  /** Переустановка привязок пользователя к объектам (PUT /users/:id/sites). */
  setSiteMappings(id: string, siteIds: string[]): Promise<void>;

  /**
   * Создание профиля пользователя-подрядчика в public.users (id уже создан в Supabase Auth).
   * Полный standalone-вариант — Iteration 6 (см. docs/iteration-6-auth-notes.md).
   */
  createCounterpartyUserRecord(input: CounterpartyUserRecord): Promise<void>;
}
