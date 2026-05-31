/**
 * Repository-интерфейс домена «error-logs».
 */
import type { CreateErrorLogBody } from '../schemas/error-log.js';

export type Row = Record<string, unknown>;

export interface ErrorLogListFilter {
  page: number;
  pageSize: number;
  errorTypes?: string[];
  dateFrom?: string;
  dateTo?: string;
}

export interface ErrorLogRepository {
  /** Список логов с пагинацией, фильтрами и join email пользователя. */
  list(filter: ErrorLogListFilter): Promise<{ data: Row[]; total: number }>;
  /** Создать запись лога. */
  create(input: CreateErrorLogBody & { userId: string }): Promise<void>;
  /** Удалить логи старше указанной даты (ISO). */
  deleteOlderThan(cutoffIso: string): Promise<void>;
}
