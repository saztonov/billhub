/**
 * SupabaseRepository для метаданных файлов (Strangler Fig, rollback-инструмент).
 * Использует динамическое имя таблицы (как исходный роут).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FileRepository, FileRecordInput } from '../file.repository.js';
import type { FileEntityType } from '../../schemas/file.js';

const ENTITY_FK_MAP: Record<FileEntityType, string> = {
  payment_request_files: 'payment_request_id',
  approval_decision_files: 'approval_decision_id',
  contract_request_files: 'contract_request_id',
  payment_payment_files: 'payment_payment_id',
  founding_document_files: 'supplier_founding_document_id',
};

export class SupabaseFileRepository implements FileRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async createFileRecord(input: FileRecordInput): Promise<{ id: string; fileKey: string }> {
    const fk = ENTITY_FK_MAP[input.entityType];
    const record: Record<string, unknown> = {
      [fk]: input.entityId,
      file_name: input.fileName,
      file_key: input.fileKey,
      file_size: input.fileSize,
      mime_type: input.mimeType,
      created_by: input.createdBy,
    };
    if (input.entityType === 'payment_request_files') {
      if (input.documentTypeId) record.document_type_id = input.documentTypeId;
      if (input.pageCount !== undefined) record.page_count = input.pageCount;
      if (input.isResubmit !== undefined) record.is_resubmit = input.isResubmit;
      if (input.isAdditional !== undefined) record.is_additional = input.isAdditional;
    }
    if (input.entityType === 'contract_request_files') {
      if (input.isAdditional !== undefined) record.is_additional = input.isAdditional;
    }
    if (input.entityType === 'founding_document_files') {
      if (input.comment !== undefined) record.comment = input.comment;
    }

    const { data, error } = await this.supabase
      .from(input.entityType)
      .insert(record)
      .select('id, file_key')
      .single();
    if (error) throw error;
    const row = data as { id: string; file_key: string };
    return { id: row.id, fileKey: row.file_key };
  }

  async deleteFileRecord(
    entityType: FileEntityType,
    entityId: string,
    fileKey: string,
  ): Promise<void> {
    const fk = ENTITY_FK_MAP[entityType];
    const { error } = await this.supabase
      .from(entityType)
      .delete()
      .eq(fk, entityId)
      .eq('file_key', fileKey);
    if (error) throw error;
  }
}
