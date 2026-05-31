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
  ForbiddenError,
} from './types.js';

export type { CounterpartyRepository } from './counterparty.repository.js';
export type { SupplierRepository } from './supplier.repository.js';
export type { UserRepository } from './user.repository.js';
export type { ReferenceRepository } from './reference.repository.js';
export type { NotificationRepository } from './notification.repository.js';
export type { CommentRepository } from './comment.repository.js';
export type { NotificationActionRepository } from './notification-action.repository.js';
export type { FileRepository } from './file.repository.js';
export type { PaymentRequestRepository } from './payment-request.repository.js';
export type { ContractRequestRepository } from './contract-request.repository.js';
export type { PaymentRepository } from './payment.repository.js';
export type { ApprovalRepository } from './approval.repository.js';
export type { AssignmentRepository } from './assignment.repository.js';
export type { ErrorLogRepository } from './error-log.repository.js';
export type { OcrModelRepository } from './ocr-model.repository.js';
export type { OmtsRpRepository } from './omts-rp.repository.js';
export type { MaterialRepository } from './material.repository.js';
export type { FoundingDocumentRepository } from './founding-document.repository.js';
export type { OcrRepository } from './ocr.repository.js';

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
  notificationActions: import('./notification-action.repository.js').NotificationActionRepository;
  files: import('./file.repository.js').FileRepository;
  paymentRequests: import('./payment-request.repository.js').PaymentRequestRepository;
  contractRequests: import('./contract-request.repository.js').ContractRequestRepository;
  payments: import('./payment.repository.js').PaymentRepository;
  approvals: import('./approval.repository.js').ApprovalRepository;
  assignments: import('./assignment.repository.js').AssignmentRepository;
  errorLogs: import('./error-log.repository.js').ErrorLogRepository;
  ocrModels: import('./ocr-model.repository.js').OcrModelRepository;
  omtsRp: import('./omts-rp.repository.js').OmtsRpRepository;
  materials: import('./material.repository.js').MaterialRepository;
  foundingDocuments: import('./founding-document.repository.js').FoundingDocumentRepository;
  ocr: import('./ocr.repository.js').OcrRepository;
}
