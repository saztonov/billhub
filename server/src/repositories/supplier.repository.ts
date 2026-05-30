/**
 * SupplierRepository — интерфейс доступа к данным поставщиков.
 */
import type {
  Supplier,
  CreateSupplierBody,
  UpdateSupplierBody,
  ListSuppliersQuery,
  SupplierListItem,
  SupplierSecurityCheck,
  SupplierSecurityDecisionBody,
} from '../schemas/supplier.js';
import type { PaginatedResult } from './types.js';

/** Параметры серверной пагинации списка поставщиков с СБ-агрегатами. */
export interface SupplierApiListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sbFilter: 'all' | 'pending';
  cutoffDate: string;
}

/** Актор бизнес-операции (для текста уведомлений и author_id). */
export interface Actor {
  id: string;
  fullName: string;
}

export interface SupplierRepository {
  getById(id: string): Promise<Supplier>;
  findById(id: string): Promise<Supplier | null>;
  findByInn(inn: string): Promise<Supplier | null>;

  /**
   * Через RPC list_suppliers_with_sb (миграция 002), который возвращает
   * last_security_status (миграция 006) и has_pending_request.
   */
  list(query: ListSuppliersQuery): Promise<PaginatedResult<Supplier>>;

  create(body: CreateSupplierBody): Promise<Supplier>;
  update(id: string, body: UpdateSupplierBody): Promise<Supplier>;
  delete(id: string): Promise<void>;

  /** Все поставщики без пагинации (обратно-совместимый GET без СБ-агрегатов). */
  listAll(): Promise<Supplier[]>;

  /** Пакетный импорт по {name, inn}; возвращает число созданных. */
  batchCreate(rows: { name: string; inn: string }[]): Promise<number>;

  /**
   * Серверная пагинация с СБ-агрегатами (RPC list_suppliers_with_sb).
   * Возвращает форму ответа роута: items + total.
   */
  listForApi(query: SupplierApiListQuery): Promise<{ items: SupplierListItem[]; total: number }>;

  /** История событий проверки СБ по поставщику (новейшие первыми). */
  getSecurityHistory(supplierId: string): Promise<SupplierSecurityCheck[]>;

  /**
   * Отправить поставщика на проверку СБ.
   * Бросает NotFoundError (нет поставщика), ConflictError (уже на проверке).
   * Создаёт событие requested и уведомляет активных security-пользователей.
   */
  requestSecurityCheck(supplierId: string, actor: Actor): Promise<SupplierSecurityCheck>;

  /**
   * Решение СБ по поставщику.
   * Бросает ValidationError (rejected без комментария), NotFoundError.
   * Создаёт событие решения, денормализует last_security_status, уведомляет инициаторов.
   */
  decideSecurityCheck(
    supplierId: string,
    actor: Actor,
    body: SupplierSecurityDecisionBody,
  ): Promise<SupplierSecurityCheck>;
}
