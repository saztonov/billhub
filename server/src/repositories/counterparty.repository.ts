/**
 * CounterpartyRepository — интерфейс доступа к данным контрагентов.
 * Strangler Fig: реализации — SupabaseRepository (текущий runtime) и DrizzleRepository (Iteration 4+).
 */
import type {
  Counterparty,
  CreateCounterpartyBody,
  UpdateCounterpartyBody,
  ListCounterpartiesQuery,
} from '../schemas/counterparty.js';
import type { PaginatedResult } from './types.js';

export interface CounterpartyRepository {
  /**
   * Получить контрагента по id.
   * Бросает NotFoundError при отсутствии.
   */
  getById(id: string): Promise<Counterparty>;

  /**
   * Получить контрагента по id или null без выкидывания ошибки.
   */
  findById(id: string): Promise<Counterparty | null>;

  /**
   * Получить контрагента по ИНН.
   */
  findByInn(inn: string): Promise<Counterparty | null>;

  /**
   * Серверная пагинация с поиском и фильтрацией по статусу СБ.
   * Через RPC list_counterparties_with_sb для возврата агрегатов last_security_status и has_pending_request.
   */
  list(query: ListCounterpartiesQuery): Promise<PaginatedResult<Counterparty>>;

  /**
   * Создать контрагента.
   * Бросает UniqueConstraintError, если ИНН уже занят.
   */
  create(body: CreateCounterpartyBody): Promise<Counterparty>;

  /**
   * Обновить.
   * Бросает NotFoundError если не найден; UniqueConstraintError при конфликте ИНН.
   */
  update(id: string, body: UpdateCounterpartyBody): Promise<Counterparty>;

  /**
   * Удалить.
   * Бросает ForeignKeyConstraintError если есть связанные заявки/файлы.
   */
  delete(id: string): Promise<void>;
}
