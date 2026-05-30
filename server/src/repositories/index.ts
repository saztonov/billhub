/**
 * Barrel-экспорт для Repository-слоя.
 *
 * Использование в роутах:
 *   const cp = await fastify.repos.counterparties.getById(id)
 *
 * Реализации:
 *   - SupabaseRepository (текущий runtime, см. ./supabase/).
 *   - DrizzleRepository (вводится в Iteration 4).
 */
export type { PaginationParams, PaginatedResult, SearchFilter } from './types.js';
export {
  NotFoundError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  ConflictError,
  ValidationError,
} from './types.js';

export type { CounterpartyRepository } from './counterparty.repository.js';
export type { SupplierRepository } from './supplier.repository.js';
export type { UserRepository } from './user.repository.js';
export type { ReferenceRepository } from './reference.repository.js';
export type { NotificationRepository } from './notification.repository.js';
export type { CommentRepository } from './comment.repository.js';

/**
 * Контейнер всех репозиториев, декорирующий FastifyInstance как `fastify.repos`.
 * Внедряется через `repositoriesPlugin` (см. plugins/repositories.ts).
 */
export interface Repositories {
  counterparties: import('./counterparty.repository.js').CounterpartyRepository;
  suppliers: import('./supplier.repository.js').SupplierRepository;
  users: import('./user.repository.js').UserRepository;
  references: import('./reference.repository.js').ReferenceRepository;
  notifications: import('./notification.repository.js').NotificationRepository;
  comments: import('./comment.repository.js').CommentRepository;
}
