/**
 * DrizzleRepository для метаданных файлов (Iteration 5).
 * entityType выбирает типизированную таблицу; вставка/удаление — в db.transaction().
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  paymentRequestFiles,
  approvalDecisionFiles,
  contractRequestFiles,
  paymentPaymentFiles,
  foundingDocumentFiles,
} from '../../db/schema/index.js';
import type { FileRepository, FileRecordInput } from '../file.repository.js';
import type { FileEntityType } from '../../schemas/file.js';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export class DrizzleFileRepository implements FileRepository {
  constructor(private readonly db: Db) {}

  async createFileRecord(input: FileRecordInput): Promise<{ id: string; fileKey: string }> {
    const base = {
      fileName: input.fileName,
      fileKey: input.fileKey,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      createdBy: input.createdBy,
    };

    return this.db.transaction(async (tx) => {
      switch (input.entityType) {
        case 'payment_request_files': {
          // document_type_id — NOT NULL без дефолта (как в исходном роуте: при отсутствии
          // вставка падает с NOT NULL violation; фронтенд всегда передаёт его для этого типа).
          const values: typeof paymentRequestFiles.$inferInsert = {
            ...base,
            paymentRequestId: input.entityId,
            documentTypeId: input.documentTypeId!,
          };
          if (input.pageCount !== undefined) values.pageCount = input.pageCount;
          if (input.isResubmit !== undefined) values.isResubmit = input.isResubmit;
          if (input.isAdditional !== undefined) values.isAdditional = input.isAdditional;
          const [row] = await tx
            .insert(paymentRequestFiles)
            .values(values)
            .returning({ id: paymentRequestFiles.id, fileKey: paymentRequestFiles.fileKey });
          return { id: row!.id, fileKey: row!.fileKey };
        }
        case 'approval_decision_files': {
          const [row] = await tx
            .insert(approvalDecisionFiles)
            .values({ ...base, approvalDecisionId: input.entityId })
            .returning({ id: approvalDecisionFiles.id, fileKey: approvalDecisionFiles.fileKey });
          return { id: row!.id, fileKey: row!.fileKey };
        }
        case 'contract_request_files': {
          const values: typeof contractRequestFiles.$inferInsert = {
            ...base,
            contractRequestId: input.entityId,
          };
          if (input.isAdditional !== undefined) values.isAdditional = input.isAdditional;
          const [row] = await tx
            .insert(contractRequestFiles)
            .values(values)
            .returning({ id: contractRequestFiles.id, fileKey: contractRequestFiles.fileKey });
          return { id: row!.id, fileKey: row!.fileKey };
        }
        case 'payment_payment_files': {
          const [row] = await tx
            .insert(paymentPaymentFiles)
            .values({ ...base, paymentPaymentId: input.entityId })
            .returning({ id: paymentPaymentFiles.id, fileKey: paymentPaymentFiles.fileKey });
          return { id: row!.id, fileKey: row!.fileKey };
        }
        case 'founding_document_files': {
          const values: typeof foundingDocumentFiles.$inferInsert = {
            ...base,
            supplierFoundingDocumentId: input.entityId,
          };
          if (input.comment !== undefined) values.comment = input.comment;
          const [row] = await tx
            .insert(foundingDocumentFiles)
            .values(values)
            .returning({ id: foundingDocumentFiles.id, fileKey: foundingDocumentFiles.fileKey });
          return { id: row!.id, fileKey: row!.fileKey };
        }
      }
    });
  }

  async deleteFileRecord(
    entityType: FileEntityType,
    entityId: string,
    fileKey: string,
  ): Promise<void> {
    await this.db.transaction(async (tx: Tx) => {
      switch (entityType) {
        case 'payment_request_files':
          await tx
            .delete(paymentRequestFiles)
            .where(
              and(
                eq(paymentRequestFiles.paymentRequestId, entityId),
                eq(paymentRequestFiles.fileKey, fileKey),
              ),
            );
          return;
        case 'approval_decision_files':
          await tx
            .delete(approvalDecisionFiles)
            .where(
              and(
                eq(approvalDecisionFiles.approvalDecisionId, entityId),
                eq(approvalDecisionFiles.fileKey, fileKey),
              ),
            );
          return;
        case 'contract_request_files':
          await tx
            .delete(contractRequestFiles)
            .where(
              and(
                eq(contractRequestFiles.contractRequestId, entityId),
                eq(contractRequestFiles.fileKey, fileKey),
              ),
            );
          return;
        case 'payment_payment_files':
          await tx
            .delete(paymentPaymentFiles)
            .where(
              and(
                eq(paymentPaymentFiles.paymentPaymentId, entityId),
                eq(paymentPaymentFiles.fileKey, fileKey),
              ),
            );
          return;
        case 'founding_document_files':
          await tx
            .delete(foundingDocumentFiles)
            .where(
              and(
                eq(foundingDocumentFiles.supplierFoundingDocumentId, entityId),
                eq(foundingDocumentFiles.fileKey, fileKey),
              ),
            );
          return;
      }
    });
  }
}
