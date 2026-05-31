/**
 * Repository-интерфейс домена «founding-documents» (учредительные документы поставщика).
 * S3-удаление файла остаётся в роуте; репозиторий покрывает только БД-операции.
 */
import type { UpdateFoundingDocBody } from '../schemas/founding-document.js';

export type Row = Record<string, unknown>;

export interface FoundingDocumentRepository {
  /** Таблица учредительных документов поставщика (типы + статусы + счётчики файлов). */
  getTable(supplierId: string): Promise<Row[]>;
  /** Upsert записи документа (is_available/comment/checked_by/checked_at). */
  upsert(
    supplierId: string,
    typeId: string,
    body: UpdateFoundingDocBody,
    userId: string,
  ): Promise<{ id: string; updated?: boolean; created?: boolean }>;
  /** Общий комментарий поставщика (null → поставщик не найден → 404). */
  getGeneralComment(supplierId: string): Promise<{ comment: string | null } | null>;
  /** Установить общий комментарий поставщика. */
  setGeneralComment(supplierId: string, comment: string | null): Promise<void>;
  /** Файлы документа (по supplier+type) с ФИО загрузивших. */
  listFiles(supplierId: string, typeId: string): Promise<Row[]>;
  /** file_key файла для удаления из S3 (null → файл не найден → 404). */
  getFileForDeletion(fileId: string): Promise<{ fileKey: string } | null>;
  /** Удалить запись файла из БД. */
  deleteFile(fileId: string): Promise<void>;
}
