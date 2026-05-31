/**
 * DrizzleFoundingDocumentRepository (Iteration 5). Учредительные документы: отдельные запросы
 * (как в роуте), мутации — в транзакции. S3-удаление файла — в роуте.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  documentTypes,
  supplierFoundingDocuments,
  foundingDocumentFiles,
  suppliers,
  users,
} from '../../db/schema/index.js';
import type { FoundingDocumentRepository, Row } from '../founding-document.repository.js';
import type { UpdateFoundingDocBody } from '../../schemas/founding-document.js';

type Db = PostgresJsDatabase<typeof schema>;
const nowIso = () => new Date().toISOString();

export class DrizzleFoundingDocumentRepository implements FoundingDocumentRepository {
  constructor(private readonly db: Db) {}

  async getTable(supplierId: string): Promise<Row[]> {
    const types = await this.db
      .select({ id: documentTypes.id, name: documentTypes.name })
      .from(documentTypes)
      .where(eq(documentTypes.category, 'founding'))
      .orderBy(asc(documentTypes.createdAt));
    if (types.length === 0) return [];

    const docs = await this.db
      .select({
        id: supplierFoundingDocuments.id,
        foundingDocumentTypeId: supplierFoundingDocuments.foundingDocumentTypeId,
        isAvailable: supplierFoundingDocuments.isAvailable,
        checkedBy: supplierFoundingDocuments.checkedBy,
        checkedAt: supplierFoundingDocuments.checkedAt,
        comment: supplierFoundingDocuments.comment,
      })
      .from(supplierFoundingDocuments)
      .where(eq(supplierFoundingDocuments.supplierId, supplierId));

    const docIds = docs.map((d) => d.id);
    const fileCounts: Record<string, number> = {};
    if (docIds.length > 0) {
      const counts = await this.db
        .select({ docId: foundingDocumentFiles.supplierFoundingDocumentId })
        .from(foundingDocumentFiles)
        .where(inArray(foundingDocumentFiles.supplierFoundingDocumentId, docIds));
      for (const row of counts) {
        fileCounts[row.docId] = (fileCounts[row.docId] ?? 0) + 1;
      }
    }

    const userIds = docs.map((d) => d.checkedBy).filter(Boolean) as string[];
    const usersMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const us = await this.db
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const u of us) usersMap[u.id] = u.fullName;
    }

    const docsMap = new Map<string, (typeof docs)[number]>();
    for (const d of docs) docsMap.set(d.foundingDocumentTypeId, d);

    return types.map((t) => {
      const doc = docsMap.get(t.id);
      const docId = doc?.id;
      return {
        type_id: t.id,
        type_name: t.name,
        doc_id: docId ?? null,
        is_available: doc?.isAvailable ?? false,
        checked_by_name: doc?.checkedBy ? (usersMap[doc.checkedBy] ?? null) : null,
        checked_at: doc?.checkedAt ?? null,
        comment: doc?.comment ?? '',
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
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: supplierFoundingDocuments.id })
        .from(supplierFoundingDocuments)
        .where(
          and(
            eq(supplierFoundingDocuments.supplierId, supplierId),
            eq(supplierFoundingDocuments.foundingDocumentTypeId, typeId),
          ),
        )
        .limit(1);

      const updates: Record<string, unknown> = { updatedAt: nowIso() };
      if (body.isAvailable !== undefined) {
        updates.isAvailable = body.isAvailable;
        if (body.isAvailable) {
          updates.checkedBy = userId;
          updates.checkedAt = nowIso();
        } else {
          updates.checkedBy = null;
          updates.checkedAt = null;
        }
      }
      if (body.comment !== undefined) updates.comment = body.comment;

      if (existing) {
        const [upd] = await tx
          .update(supplierFoundingDocuments)
          .set(updates)
          .where(eq(supplierFoundingDocuments.id, existing.id))
          .returning({ id: supplierFoundingDocuments.id });
        return { id: upd!.id, updated: true };
      }

      const [created] = await tx
        .insert(supplierFoundingDocuments)
        .values({ supplierId, foundingDocumentTypeId: typeId, ...updates })
        .returning({ id: supplierFoundingDocuments.id });
      return { id: created!.id, created: true };
    });
  }

  async getGeneralComment(supplierId: string): Promise<{ comment: string | null } | null> {
    const [row] = await this.db
      .select({ comment: suppliers.foundingDocumentsComment })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId))
      .limit(1);
    if (!row) return null;
    return { comment: row.comment ?? null };
  }

  async setGeneralComment(supplierId: string, comment: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(suppliers)
        .set({ foundingDocumentsComment: comment })
        .where(eq(suppliers.id, supplierId));
    });
  }

  async listFiles(supplierId: string, typeId: string): Promise<Row[]> {
    const [doc] = await this.db
      .select({ id: supplierFoundingDocuments.id })
      .from(supplierFoundingDocuments)
      .where(
        and(
          eq(supplierFoundingDocuments.supplierId, supplierId),
          eq(supplierFoundingDocuments.foundingDocumentTypeId, typeId),
        ),
      )
      .limit(1);
    if (!doc) return [];

    const files = await this.db
      .select({
        id: foundingDocumentFiles.id,
        file_name: foundingDocumentFiles.fileName,
        file_key: foundingDocumentFiles.fileKey,
        file_size: foundingDocumentFiles.fileSize,
        mime_type: foundingDocumentFiles.mimeType,
        comment: foundingDocumentFiles.comment,
        created_by: foundingDocumentFiles.createdBy,
        created_at: foundingDocumentFiles.createdAt,
      })
      .from(foundingDocumentFiles)
      .where(eq(foundingDocumentFiles.supplierFoundingDocumentId, doc.id))
      .orderBy(desc(foundingDocumentFiles.createdAt));

    const userIds = files.map((f) => f.created_by).filter(Boolean) as string[];
    const usersMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const us = await this.db
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(inArray(users.id, [...new Set(userIds)]));
      for (const u of us) usersMap[u.id] = u.fullName;
    }

    return files.map((f) => ({
      ...f,
      created_by_name: usersMap[f.created_by] ?? null,
    }));
  }

  async getFileForDeletion(fileId: string): Promise<{ fileKey: string } | null> {
    const [file] = await this.db
      .select({ fileKey: foundingDocumentFiles.fileKey })
      .from(foundingDocumentFiles)
      .where(eq(foundingDocumentFiles.id, fileId))
      .limit(1);
    if (!file) return null;
    return { fileKey: file.fileKey };
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(foundingDocumentFiles).where(eq(foundingDocumentFiles.id, fileId));
    });
  }
}
