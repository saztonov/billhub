/**
 * Журнал выгрузки счетов в SIGNAL DOCS (sgnl_file_exports, 0023) и отбор кандидатов.
 *
 * Правила отбора счетов:
 *   - вложения заявок с типом документа «Счет», включая зачёркнутые (is_rejected);
 *   - заявка не удалена и не в статусе «Отклонена»/«Отозвана»;
 *   - у заявки есть поставщик, у объекта — проект SIGNAL;
 *   - в журнале нет строки done/skipped (pending и failed повторяются).
 */
import { sql } from 'drizzle-orm';
import type { BillhubDatabase } from '../../plugins/database-drizzle.js';
import { sgnlFileExports } from '../../db/schema/index.js';
import type {
  SgnlExportStatus,
  SgnlExportStore,
  SgnlExportWrite,
  SgnlSkippedSummary,
  SgnlSyncCandidate,
} from '../../services/sgnl/sgnl-sync-types.js';

/** Тип документа «Счет» (тот же ID, что в OCR и материалах) */
const INVOICE_DOC_TYPE_ID = 'c3c0b242-8a0c-4e20-b9ad-363ebf462a5b';

/** Строка кандидата из SQL */
interface CandidateRow {
  file_id: string;
  payment_request_id: string;
  request_number: string;
  file_name: string;
  file_key: string;
  mime_type: string | null;
  site_id: string;
  site_name: string;
  sgnl_project_id: string;
  sgnl_project_name: string | null;
  sgnl_base_path: string | null;
  supplier_id: string;
  supplier_name: string;
  supplier_inn: string;
  export_status: SgnlExportStatus | null;
  export_folder_id: string | null;
  export_version_id: string | null;
  export_target_name: string | null;
  export_attempts: number | null;
}

/** Строка журнала с ошибкой — для админки */
export interface SgnlExportErrorRow {
  id: string;
  requestNumber: string | null;
  fileName: string | null;
  siteName: string | null;
  targetPath: string;
  targetName: string;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

/** Сводка журнала по статусам — для админки */
export interface SgnlExportStats {
  counts: Record<SgnlExportStatus, number>;
  lastExportedAt: string | null;
}

/** Строки результата db.execute: массив (postgres.js) или { rows } (другие драйверы) */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/** Общий фрагмент отбора подходящих счетов (без условий на сопоставление и журнал) */
function eligibleFrom(siteId: string | undefined) {
  return sql`
    FROM payment_request_files f
    JOIN payment_requests pr ON pr.id = f.payment_request_id
    JOIN statuses st ON st.id = pr.status_id
    JOIN construction_sites cs ON cs.id = pr.site_id
    WHERE f.document_type_id = ${INVOICE_DOC_TYPE_ID}
      AND pr.is_deleted = false
      AND st.code NOT IN ('rejected', 'withdrawn')
      ${siteId ? sql`AND pr.site_id = ${siteId}` : sql``}`;
}

export class DrizzleSgnlExportRepository implements SgnlExportStore {
  constructor(private readonly db: BillhubDatabase) {}

  async listCandidates(filter: { siteId?: string }): Promise<SgnlSyncCandidate[]> {
    const rows = rowsOf<CandidateRow>(
      await this.db.execute(sql`
      SELECT f.id AS file_id, pr.id AS payment_request_id, pr.request_number,
             f.file_name, f.file_key, f.mime_type,
             cs.id AS site_id, cs.name AS site_name,
             cs.sgnl_project_id, cs.sgnl_project_name, cs.sgnl_base_path,
             sp.id AS supplier_id, sp.name AS supplier_name, sp.inn AS supplier_inn,
             e.status AS export_status, e.sgnl_folder_id AS export_folder_id,
             e.sgnl_version_id AS export_version_id, e.target_name AS export_target_name,
             e.attempts AS export_attempts
      FROM payment_request_files f
      JOIN payment_requests pr ON pr.id = f.payment_request_id
      JOIN statuses st ON st.id = pr.status_id
      JOIN construction_sites cs ON cs.id = pr.site_id
      JOIN suppliers sp ON sp.id = pr.supplier_id
      LEFT JOIN sgnl_file_exports e ON e.payment_request_file_id = f.id
      WHERE f.document_type_id = ${INVOICE_DOC_TYPE_ID}
        AND pr.is_deleted = false
        AND st.code NOT IN ('rejected', 'withdrawn')
        AND cs.sgnl_project_id IS NOT NULL
        AND (e.id IS NULL OR e.status IN ('pending', 'failed'))
        ${filter.siteId ? sql`AND pr.site_id = ${filter.siteId}` : sql``}
      ORDER BY cs.name, sp.name, pr.request_number, f.created_at
    `),
    );

    return rows.map((r) => ({
      fileId: r.file_id,
      paymentRequestId: r.payment_request_id,
      requestNumber: r.request_number,
      fileName: r.file_name,
      fileKey: r.file_key,
      mimeType: r.mime_type,
      siteId: r.site_id,
      siteName: r.site_name,
      sgnlProjectId: r.sgnl_project_id,
      sgnlProjectName: r.sgnl_project_name,
      sgnlBasePath: r.sgnl_base_path,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      supplierInn: r.supplier_inn,
      previous: r.export_status
        ? {
            status: r.export_status,
            sgnlFolderId: r.export_folder_id,
            sgnlVersionId: r.export_version_id,
            targetName: r.export_target_name ?? '',
            attempts: Number(r.export_attempts ?? 0),
          }
        : null,
    }));
  }

  async listSkipped(filter: { siteId?: string }): Promise<SgnlSkippedSummary> {
    const from = eligibleFrom(filter.siteId);
    const [unmapped, noSupplier] = await Promise.all([
      this.db.execute(sql`
        SELECT cs.id AS site_id, cs.name AS site_name, count(*)::int AS files
        ${from} AND cs.sgnl_project_id IS NULL AND pr.supplier_id IS NOT NULL
        GROUP BY cs.id, cs.name ORDER BY cs.name`),
      this.db.execute(sql`SELECT count(*)::int AS files ${from} AND pr.supplier_id IS NULL`),
    ]);
    const unmappedRows = rowsOf<{ site_id: string; site_name: string; files: number }>(unmapped);
    const noSupplierRows = rowsOf<{ files: number }>(noSupplier);
    return {
      unmappedSites: unmappedRows.map((r) => ({
        siteId: r.site_id,
        siteName: r.site_name,
        files: Number(r.files),
      })),
      noSupplierFiles: Number(noSupplierRows[0]?.files ?? 0),
    };
  }

  async listKnownSupplierFolders(projectId: string): Promise<Map<string, string>> {
    const rows = rowsOf<{ supplier_id: string; sgnl_folder_id: string }>(
      await this.db.execute(sql`
      SELECT DISTINCT ON (supplier_id) supplier_id, sgnl_folder_id
      FROM sgnl_file_exports
      WHERE sgnl_project_id = ${projectId} AND status = 'done'
        AND supplier_id IS NOT NULL AND sgnl_folder_id IS NOT NULL
      ORDER BY supplier_id, exported_at DESC NULLS LAST
    `),
    );
    return new Map(rows.map((r) => [r.supplier_id, r.sgnl_folder_id]));
  }

  /**
   * Upsert строки журнала по файлу. Непереданные (undefined) sgnl-поля не меняются —
   * так ошибка после создания версии не теряет её id для продолжения.
   */
  async save(write: SgnlExportWrite): Promise<void> {
    const c = write.candidate;
    const optional: Partial<typeof sgnlFileExports.$inferInsert> = {};
    if (write.sgnlFolderId !== undefined) optional.sgnlFolderId = write.sgnlFolderId;
    if (write.sgnlObjectId !== undefined) optional.sgnlObjectId = write.sgnlObjectId;
    if (write.sgnlVersionId !== undefined) optional.sgnlVersionId = write.sgnlVersionId;
    if (write.sgnlItemId !== undefined) optional.sgnlItemId = write.sgnlItemId;
    if (write.lastError !== undefined) optional.lastError = write.lastError;

    const isFailed = write.status === 'failed';
    const isDone = write.status === 'done';
    await this.db
      .insert(sgnlFileExports)
      .values({
        paymentRequestFileId: c.fileId,
        paymentRequestId: c.paymentRequestId,
        siteId: c.siteId,
        supplierId: c.supplierId,
        sgnlProjectId: c.sgnlProjectId,
        targetPath: write.targetPath,
        targetName: write.targetName,
        status: write.status,
        attempts: isFailed ? 1 : 0,
        exportedAt: isDone ? sql`now()` : null,
        ...optional,
      })
      .onConflictDoUpdate({
        target: sgnlFileExports.paymentRequestFileId,
        set: {
          sgnlProjectId: c.sgnlProjectId,
          siteId: c.siteId,
          supplierId: c.supplierId,
          targetPath: write.targetPath,
          targetName: write.targetName,
          status: write.status,
          updatedAt: sql`now()`,
          ...(isFailed ? { attempts: sql`${sgnlFileExports.attempts} + 1` } : {}),
          ...(isDone ? { exportedAt: sql`now()` } : {}),
          ...optional,
        },
      });
  }

  /* ---------------------------- Админка ---------------------------- */

  async getStats(): Promise<SgnlExportStats> {
    const rows = rowsOf<{ status: SgnlExportStatus; cnt: number; last_exported_at: string | null }>(
      await this.db.execute(sql`
      SELECT status, count(*)::int AS cnt, max(exported_at) AS last_exported_at
      FROM sgnl_file_exports GROUP BY status
    `),
    );
    const counts: Record<SgnlExportStatus, number> = { pending: 0, done: 0, failed: 0, skipped: 0 };
    let lastExportedAt: string | null = null;
    for (const r of rows) {
      counts[r.status] = Number(r.cnt);
      if (r.status === 'done' && r.last_exported_at) {
        lastExportedAt = new Date(r.last_exported_at).toISOString();
      }
    }
    return { counts, lastExportedAt };
  }

  async listErrors(limit: number): Promise<SgnlExportErrorRow[]> {
    const rows = rowsOf<{
      id: string;
      request_number: string | null;
      file_name: string | null;
      site_name: string | null;
      target_path: string;
      target_name: string;
      attempts: number;
      last_error: string | null;
      updated_at: string;
    }>(
      await this.db.execute(sql`
      SELECT e.id, pr.request_number, f.file_name, cs.name AS site_name,
             e.target_path, e.target_name, e.attempts, e.last_error, e.updated_at
      FROM sgnl_file_exports e
      LEFT JOIN payment_request_files f ON f.id = e.payment_request_file_id
      LEFT JOIN payment_requests pr ON pr.id = e.payment_request_id
      LEFT JOIN construction_sites cs ON cs.id = e.site_id
      WHERE e.status = 'failed'
      ORDER BY e.updated_at DESC
      LIMIT ${limit}
    `),
    );
    return rows.map((r) => ({
      id: r.id,
      requestNumber: r.request_number,
      fileName: r.file_name,
      siteName: r.site_name,
      targetPath: r.target_path,
      targetName: r.target_name,
      attempts: Number(r.attempts),
      lastError: r.last_error,
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }
}
