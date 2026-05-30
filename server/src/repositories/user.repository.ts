/**
 * UserRepository — интерфейс доступа к данным пользователей.
 *
 * В Iteration 6 (standalone auth) добавляются методы для управления password_hash
 * и refresh_tokens. Сейчас (Iteration 3) интерфейс покрывает только базовый CRUD + checks для logIn.
 */
import type { User, CreateUserBody, UpdateUserBody, ListUsersQuery } from '../schemas/user.js';
import type { PaginatedResult } from './types.js';

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
}
