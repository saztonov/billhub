/**
 * SupabaseFoundingDocumentRepository — rollback-провайдер учредительных документов (Iteration 5).
 * Дословный порт БД-логики routes/founding-documents.ts (S3-удаление осталось в роуте).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FoundingDocumentRepository, Row } from '../founding-document.repository.js';
import type { UpdateFoundingDocBody } from '../../schemas/founding-document.js';

export class SupabaseFoundingDocumentRepository implements FoundingDocumentRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getTable(supplierId: string): Promise<Row[]> {
    const { data: types, error: typesError } = await this.supabase
      .from('document_types')
      .select('id, name')
      .eq('category', 'founding')
      .order('created_at', { ascending: true });
    if (typesError) throw new Error(typesError.message);
    if (!types || types.length === 0) return [];

    const { data: docs, error: docsError } = await this.supabase
      .from('supplier_founding_documents')
      .select('id, founding_document_type_id, is_available, checked_by, checked_at, comment')
      .eq('supplier_id', supplierId);
    if (docsError) throw new Error(docsError.message);

    const docIds = (docs ?? []).map((d: Row) => d.id as string);

    const fileCounts: Record<string, number> = {};
    if (docIds.length > 0) {
      const { data: counts, error: countError } = await this.supabase
        .from('founding_document_files')
        .select('supplier_founding_document_id')
        .in('supplier_founding_document_id', docIds);
      if (!countError && counts) {
        for (const row of counts) {
          const key = (row as Row).supplier_founding_document_id as string;
          fileCounts[key] = (fileCounts[key] ?? 0) + 1;
        }
      }
    }

    const userIds = (docs ?? []).map((d: Row) => d.checked_by as string).filter(Boolean);
    const usersMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: users } = await this.supabase
        .from('users')
        .select('id, full_name')
        .in('id', userIds);
      if (users) {
        for (const u of users) {
          usersMap[(u as Row).id as string] = (u as Row).full_name as string;
        }
      }
    }

    const docsMap = new Map<string, Row>();
    for (const d of (docs ?? []) as Row[]) {
      docsMap.set(d.founding_document_type_id as string, d);
    }

    return types.map((t: Row) => {
      const doc = docsMap.get(t.id as string);
      const docId = doc?.id as string | undefined;
      return {
        type_id: t.id,
        type_name: t.name,
        doc_id: docId ?? null,
        is_available: (doc?.is_available as boolean) ?? false,
        checked_by_name: doc?.checked_by ? (usersMap[doc.checked_by as string] ?? null) : null,
        checked_at: doc?.checked_at ?? null,
        comment: (doc?.comment as string) ?? '',
        file_count: docId ? (fileCounts[docId] ?? 0) : 0,
      };
    });
  }

  async upsert(
    supplierId: string,
    typeId: string,
    body: UpdateFoundingDocBody,
    userId: string,
  ): Promise<{ id: string; updated?: boolean; created?: boolean }> {
    const { data: existing } = await this.supabase
      .from('supplier_founding_documents')
      .select('id, is_available')
      .eq('supplier_id', supplierId)
      .eq('founding_document_type_id', typeId)
      .maybeSingle();

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.isAvailable !== undefined) {
      updates.is_available = body.isAvailable;
      if (body.isAvailable) {
        updates.checked_by = userId;
        updates.checked_at = new Date().toISOString();
      } else {
        updates.checked_by = null;
        updates.checked_at = null;
      }
    }
    if (body.comment !== undefined) updates.comment = body.comment;

    if (existing) {
      const { data, error } = await this.supabase
        .from('supplier_founding_documents')
        .update(updates)
        .eq('id', (existing as Row).id)
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return { id: (data as Row).id as string, updated: true };
    }

    const insertData: Record<string, unknown> = {
      supplier_id: supplierId,
      founding_document_type_id: typeId,
      ...updates,
    };
    const { data, error } = await this.supabase
      .from('supplier_founding_documents')
      .insert(insertData)
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return { id: (data as Row).id as string, created: true };
  }

  async getGeneralComment(supplierId: string): Promise<{ comment: string | null } | null> {
    const { data, error } = await this.supabase
      .from('suppliers')
      .select('founding_documents_comment')
      .eq('id', supplierId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return { comment: (data as Row).founding_documents_comment as string | null };
  }

  async setGeneralComment(supplierId: string, comment: string | null): Promise<void> {
    const { error } = await this.supabase
      .from('suppliers')
      .update({ founding_documents_comment: comment })
      .eq('id', supplierId);
    if (error) throw new Error(error.message);
  }

  async listFiles(supplierId: string, typeId: string): Promise<Row[]> {
    const { data: doc } = await this.supabase
      .from('supplier_founding_documents')
      .select('id')
      .eq('supplier_id', supplierId)
      .eq('founding_document_type_id', typeId)
      .maybeSingle();
    if (!doc) return [];

    const docId = (doc as Row).id as string;
    const { data: files, error } = await this.supabase
      .from('founding_document_files')
      .select('id, file_name, file_key, file_size, mime_type, comment, created_by, created_at')
      .eq('supplier_founding_document_id', docId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const userIds = (files ?? []).map((f: Row) => f.created_by as string).filter(Boolean);
    const usersMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: users } = await this.supabase
        .from('users')
        .select('id, full_name')
        .in('id', [...new Set(userIds)]);
      if (users) {
        for (const u of users) {
          usersMap[(u as Row).id as string] = (u as Row).full_name as string;
        }
      }
    }

    return (files ?? []).map((f: Row) => ({
      ...f,
      created_by_name: usersMap[f.created_by as string] ?? null,
    }));
  }

  async getFileForDeletion(fileId: string): Promise<{ fileKey: string } | null> {
    const { data: file, error } = await this.supabase
      .from('founding_document_files')
      .select('id, file_key')
      .eq('id', fileId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!file) return null;
    return { fileKey: (file as Row).file_key as string };
  }

  async deleteFile(fileId: string): Promise<void> {
    const { error } = await this.supabase.from('founding_document_files').delete().eq('id', fileId);
    if (error) throw new Error(error.message);
  }
}
