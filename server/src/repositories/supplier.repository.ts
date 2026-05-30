/**
 * SupplierRepository — интерфейс доступа к данным поставщиков.
 */
import type {
  Supplier,
  CreateSupplierBody,
  UpdateSupplierBody,
  ListSuppliersQuery,
} from '../schemas/supplier.js';
import type { PaginatedResult } from './types.js';

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
}
