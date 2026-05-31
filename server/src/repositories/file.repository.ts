/**
 * FileRepository — метаданные файлов в 5 таблицах (payment_request_files,
 * approval_decision_files, contract_request_files, payment_payment_files,
 * founding_document_files). entityType выбирает таблицу.
 * Strangler Fig: Supabase (rollback) и Drizzle.
 */
import type { FileEntityType } from '../schemas/file.js';

/** Входные данные для создания записи метаданных файла. */
export interface FileRecordInput {
  entityType: FileEntityType;
  entityId: string;
  fileName: string;
  fileKey: string;
  fileSize: number;
  mimeType: string;
  createdBy: string;
  /** Доп. поля payment_request_files */
  documentTypeId?: string;
  pageCount?: number;
  isResubmit?: boolean;
  /** payment_request_files и contract_request_files */
  isAdditional?: boolean;
  /** founding_document_files */
  comment?: string;
}

export interface FileRepository {
  /** Создаёт запись метаданных файла в таблице по entityType. Возвращает id и file_key. */
  createFileRecord(input: FileRecordInput): Promise<{ id: string; fileKey: string }>;

  /** Удаляет запись метаданных файла по (FK=entityId, file_key). */
  deleteFileRecord(entityType: FileEntityType, entityId: string, fileKey: string): Promise<void>;
}
