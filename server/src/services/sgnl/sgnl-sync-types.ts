/**
 * Типы выгрузки счетов в SIGNAL: кандидаты, журнал, отчёт прогона.
 */

/** Статусы строки журнала sgnl_file_exports */
export type SgnlExportStatus = 'pending' | 'done' | 'failed' | 'skipped';

/** Ранее записанное состояние выгрузки файла (строка журнала, не done) */
export interface SgnlExportState {
  status: SgnlExportStatus;
  sgnlFolderId: string | null;
  sgnlVersionId: string | null;
  targetName: string;
  attempts: number;
}

/** Файл счёта, подлежащий выгрузке */
export interface SgnlSyncCandidate {
  fileId: string;
  paymentRequestId: string;
  requestNumber: string;
  fileName: string;
  fileKey: string;
  mimeType: string | null;
  siteId: string;
  siteName: string;
  sgnlProjectId: string;
  sgnlProjectName: string | null;
  sgnlBasePath: string | null;
  supplierId: string;
  supplierName: string;
  supplierInn: string;
  /** Состояние из журнала, если файл уже пытались выгрузить */
  previous: SgnlExportState | null;
}

/** Пропущенные при отборе файлы (для отчёта) */
export interface SgnlSkippedSummary {
  /** Объекты с подходящими счетами, но без проекта SIGNAL */
  unmappedSites: { siteId: string; siteName: string; files: number }[];
  /** Счета заявок без поставщика */
  noSupplierFiles: number;
}

/** Запись журнала (upsert по fileId) */
export interface SgnlExportWrite {
  candidate: SgnlSyncCandidate;
  status: SgnlExportStatus;
  targetPath: string;
  targetName: string;
  sgnlFolderId?: string | null;
  sgnlObjectId?: string | null;
  sgnlVersionId?: string | null;
  sgnlItemId?: string | null;
  lastError?: string | null;
}

/** Хранилище журнала и источник кандидатов (реализация — Drizzle-репозиторий) */
export interface SgnlExportStore {
  listCandidates(filter: { siteId?: string }): Promise<SgnlSyncCandidate[]>;
  listSkipped(filter: { siteId?: string }): Promise<SgnlSkippedSummary>;
  /** Папки поставщиков, уже использованные успешными выгрузками: supplierId → folderId */
  listKnownSupplierFolders(projectId: string): Promise<Map<string, string>>;
  save(write: SgnlExportWrite): Promise<void>;
}

/** Итог по одной группе (проект SIGNAL + подпапка) */
export interface SgnlProjectReport {
  projectId: string;
  projectName: string | null;
  basePath: string | null;
  sites: string[];
  files: number;
  uploaded: number;
  failed: number;
  /** Пути папок, которые будут/были созданы */
  foldersToCreate: string[];
  /** Ошибка уровня проекта (нет «12. Снабжение», недоступно дерево и т.п.) */
  error?: string;
}

/** Ошибка по отдельному файлу */
export interface SgnlFileError {
  requestNumber: string;
  fileName: string;
  path: string;
  error: string;
}

/** Отчёт прогона выгрузки */
export interface SgnlSyncReport {
  dryRun: boolean;
  siteId: string | null;
  startedAt: string;
  finishedAt: string;
  totals: { candidates: number; uploaded: number; failed: number };
  projects: SgnlProjectReport[];
  skipped: SgnlSkippedSummary;
  /** Первые ошибки по файлам (не больше MAX_REPORT_ERRORS) */
  errors: SgnlFileError[];
  /** Прогон прерван фатальной ошибкой (авторизация, квота) */
  aborted?: string;
}
